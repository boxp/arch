// Keshin2D のエンジン。パーツに分けたキャラクターの絵を、ブラウザ（WebGL2）で動かす。
// models/<名前>/model.json と models/<名前>/parts/*.png を読み（partsgen/tools/pipeline.py が書き出す）、
// レイヤー 1 枚ごとに格子メッシュを張って、毎フレーム頂点を動かして描く。
// 座標は、横 3000 の絵の座標（顔の中心 x=1500、頭頂 y=111、あご先 y=1167。build2.py が、どのキャラもこの位置に合わせる）。
// コメントの中の「目安」「ねらい」は、この動きを作るときに、動かして見ながら決めた、ねらいの値。
// 「PSD」は、この仕組みを作り始めたときの、人が手でパーツ分けした絵のモデル（このリポジトリには入っていない。レイヤーの名前と座標は、そこから来ている）。
//
//   顔の向き : 頭の立体（疑似奥行き）に沿って各パーツをずらす。目・眉・口は歪ませず、
//              その場所での「ずれ・縮み・傾き」だけを掛ける
//   目       : 白目の上端・下端をまぶたの線として、閉じ目（∪）・笑い目（∩）の線へ寄せる
//   口       : 上下の唇の曲線を式で作り、線の画像をその曲線に沿わせる。口の中はマスクで切り抜く
//   髪       : ばね振り子で揺らす。頭の動きと傾きが入力
//   切り抜き : 顔・左右の白目・口の中の 4 つを 1 枚のマスク画像（RGBA の各チャンネル）に描いて使う

const q = new URLSearchParams(location.search);
// あとから読み込む js（keyshape.js・lipsync.js）に付ける印。index.html が付けた ?v= と同じ値（無ければ今の時刻）。
// 印が無いと、ブラウザが前の版をしまったまま使い、強制更新でも古い keyshape.js のままになることがある
const JS_V = new URL(import.meta.url).searchParams.get('v') || String(Date.now());
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// ---- パラメータ ------------------------------------------------------------
// R / L は PSD の名前どおり「キャラクターから見て」。R が画面の左側に映る
const PARAMS = [
  { key: 'yaw', label: '顔の左右', min: -30, max: 30, def: 0, k: 9 },
  { key: 'pitch', label: '顔の上下', min: -25, max: 25, def: 0, k: 9 },
  { key: 'roll', label: '顔のかしげ', min: -45, max: 45, def: 0, k: 9 },   // ±25 が「かしげの上限」（tune.rollMax）。手で動かすときは、それより外まで動かせる
  { key: 'bodyX', label: '体の左右', min: -1, max: 1, def: 0, k: 5 },
  { key: 'eyeR', label: '右目（画面左）', min: 0, max: 1.2, def: 1, k: 45 },
  { key: 'eyeL', label: '左目（画面右）', min: 0, max: 1.2, def: 1, k: 45 },
  { key: 'eyeSmile', label: '笑い目', min: 0, max: 1, def: 0, k: 18 },
  { key: 'gazeX', label: '視線 左右', min: -1, max: 1, def: 0, k: 24 },
  { key: 'gazeY', label: '視線 上下', min: -1, max: 1, def: 0, k: 24 },
  { key: 'browY', label: '眉の上下', min: -1, max: 1, def: 0, k: 16 },
  { key: 'browAngle', label: '眉の角度', min: -1, max: 1, def: 0, k: 16 },
  { key: 'browShow', label: '眉を髪の上に', min: 0, max: 1, def: 0, k: 12 },
  // キーの形で動く目（model.json の keyEye）・顔の全部を動かす表情で使う値（無いモデルでは、眉の形とほほの赤み・瞳の大きさだけ効く）
  { key: 'eyeTilt', label: '目の傾き（困り − / にらみ +）', min: -1, max: 1, def: 0, k: 18 },
  { key: 'eyeJito', label: 'ジト目', min: 0, max: 1, def: 0, k: 18 },
  { key: 'eyeShut', label: 'ぎゅっと閉じる', min: 0, max: 1, def: 0, k: 18 },
  { key: 'irisSize', label: '瞳の大きさ', min: -1, max: 1, def: 0, k: 18 },
  { key: 'cheek', label: 'ほほの赤み', min: 0, max: 1, def: 0, k: 10 },
  { key: 'browForm', label: '眉の形（山なり +）', min: -1, max: 1, def: 0, k: 16 },
  { key: 'mouthOpen', label: '口の開き', min: 0, max: 1, def: 0, k: 32 },
  { key: 'mouthForm', label: '口の形', min: -1, max: 1, def: 0, k: 16 },
  { key: 'mouthWidth', label: '口の幅', min: 0.4, max: 1.3, def: 1, k: 20 },
  // 口の形 2（model.json の mouthVector.style が 2 のモデルで効く）
  { key: 'mouthRound', label: '口のすぼめ', min: 0, max: 1, def: 0, k: 22 },
  { key: 'mouthTeeth', label: '歯を見せる', min: 0, max: 1, def: 0, k: 22 },
  { key: 'mouthWave', label: '口の線の波', min: 0, max: 1, def: 0, k: 14 },
  { key: 'mouthFang', label: '八重歯', min: 0, max: 1, def: 0, k: 14 },          // 開いた口の、上の線から下がる小さな牙（画面右側）
  { key: 'mouthTongue', label: '舌を出す', min: 0, max: 1, def: 0, k: 14 },      // 閉じた口の線の下に、舌の先を出す（てへ）
  { key: 'mouthY', label: '口の上下の位置', min: -1, max: 1, def: 0, k: 22 },
  { key: 'mouthTop', label: '口の上の線の反り', min: -1, max: 1, def: 0, k: 22 },
  { key: 'mouthPoint', label: '口の下のとがり', min: 0, max: 1, def: 0, k: 22 },
  { key: 'mouthLift', label: '口の開く向き（上へ）', min: 0, max: 1, def: 0.15, k: 22 },
];
const TUNE = [
  // 可動域。スライダーやマウス・カメラをいっぱいに振ったとき、実際に何度まで回すか。
  // 左右 41°・上 13°・下 30°まで振ると崩れるので、9 方向のボタンで見ながら決めた値を既定にしている。
  // モデルごとの値は model.json の tune で置き換える
  { key: 'yawMax', label: '左右の上限(°)', min: 5, max: 33, def: 20, step: 0.5 },
  { key: 'upMax', label: '上向きの上限(°)', min: 0, max: 16, def: 5, step: 0.5 },
  { key: 'downMax', label: '下向きの上限(°)', min: 0, max: 31, def: 5, step: 0.5 },
  { key: 'rollMax', label: 'かしげの上限(°)', min: 0, max: 25, def: 18, step: 0.5 },
  { key: 'depth', label: '顔の奥行き', min: 0.5, max: 1.3, def: 1 },
  { key: 'sway', label: '髪の揺れやすさ', min: 0, max: 2.5, def: 1.5 },
  // 横を向いたとき、鼻と口を「立体の上にある物」らしく動かす強さ（0 で前と同じ。位置を余分にずらし、奥の側を詰めて手前の側を伸ばす）
  { key: 'solid', label: '鼻と口の立体感', min: 0, max: 2, def: 1 },
  // 上下を向いたとき、鼻と口を、目と同じ奥行きで動かす（0 で前と同じ = 鼻と口だけ、目より大きく上下に滑る）。
  // 上下の上限を大きくしたモデル（上 16°・下 28°など）で、斜めを向くと鼻が奥の目や口にぶつかるのを防ぐ。makeGroup の opt.fit
  { key: 'faceFit', label: '上下の向きで、鼻と口を目と一緒に動かす', min: 0, max: 1, def: 0 },
  // 横を向いたとき、口の左右の伸び縮みを、顔の丸みのぶんだけにする（0 で前と同じ = 手前の側を大きく伸ばし、奥の側を大きく詰める）。
  // 左右の上限を大きくしたモデル（30°など）で、口の底が向いた側へ突き出て、あごがしゃくれたように見えるのを防ぐ。makeGroup の opt.round
  { key: 'mouthFit', label: '横向きで、口の形を左右に崩さない', min: 0, max: 1, def: 0 },
  // 下を向いたとき、口を小さくする（上から見下ろすぶん。0 で前と同じ）。大きさ = 1 − この値 × sin(下向きの角度)。makeGroup の opt.mouthPitch
  { key: 'mouthDownSize', label: '下向きで、口を小さくする', min: 0, max: 3, def: 0 },
  // 上下を向いたとき、口を顔の丸みに沿って曲げる（0 で前と同じ）。下向きで口角が上がり（∪ が強まる）、上向きで口角が下がる
  { key: 'mouthPitchBend', label: '上下の向きで、口を顔の丸みに沿って曲げる', min: 0, max: 2, def: 0 },
  // 横を向いたとき、目と眉を、あご先と同じだけ動かす（0 で前と同じ = 目が、あご・口・鼻より遅れて、顔の下半分が前へ突き出て見える）。
  // ねらい: 左右いっぱいでも、あご先が、両目のまん中の真下にある。makeGroup の opt.xz
  { key: 'eyeFit', label: '横向きで、目と眉を、あご先に合わせて動かす', min: 0, max: 1.3, def: 0 },
  // 斜めを向いたとき、顔の中心線を傾ける（0 で前と同じ = 上下を向いても、左右の位置が変わらない）。
  // 下を向くと目が先へ、上を向くとあご先が先へ出る（頭を、立体として回したときの動き）。あご先の高さを支点に、頭の全体（髪・帽子も）を横へずらす。tiltT
  { key: 'headTilt', label: '斜めで、顔の中心線を傾ける', min: 0, max: 1.6, def: 0 },
  // 下を向いたとき、ほほの輪郭を、目と一緒に下げる（0 で前と同じ = 輪郭のいちばん広い所は動かず、目だけが、あごへ向かって細くなる所まで滑り下りる。
  // 目の大きいキャラでは、白目の外の端が、輪郭の外へ出る）。斜め下では、奥のほほの輪郭を、向きに応じて、さらに下げて、少しふくらませる
  // （奥の輪郭は、頭の横ではなく、ほほの前の面でできる）。あご先と、頭のてっぺんは、動かさない。surfMap の Z0D2
  { key: 'faceDown', label: '下向きで、ほほの輪郭を、目と一緒に下げる', min: 0, max: 1.5, def: 0 },
  // 振り向いたとき、髪が取り残されて流れる強さ（0 で前と同じ。前の髪と後ろ髪は逆向きに流れる）
  { key: 'turn', label: '振り向きの髪の流れ', min: 0, max: 2, def: 1 },
  // 動きの味付け（どれも 0 で前と同じ）
  { key: 'strand', label: '髪の房ごとのばらつき', min: 0, max: 2, def: 1 },       // 左右の横髪・後ろ髪の左右が、少しずつ違う速さ・大きさで揺れる
  // 毛束ごとに分けた髪（model.json の hairLocks）のふわふわ感。毛先の束ごとの遅れ・左右へ伝わる遅れ・上下に弾んだときの広がり・待機中のそよぎ（0 で、髪の全体が 1 つのしなりで動く）
  { key: 'fluff', label: '毛束のふわふわ', min: 0, max: 2.5, def: 1 },
  { key: 'exprLive', label: '表情の切り替わりのはずみ', min: 0, max: 2, def: 1 },  // 目 → まゆ → 口角の順に、少し行きすぎてから落ち着く
  { key: 'link', label: 'まゆ・下まぶたの連動', min: 0, max: 2, def: 1 },          // 視線・まばたき・口に、まゆと下まぶたがついて動く
  // まゆが、目の開きについて「はずんで」動く（ねらい: 目を閉じると下がり、見開くと上がる。ばねで行きすぎて戻る）。0 で前と同じ（遅れずについていくだけ）
  { key: 'browBounce', label: 'まゆのはずみ（目の開きについて）', min: 0, max: 2, def: 0 },
  { key: 'bodyMove', label: '体の動き（呼吸・遅れ・ひねり）', min: 0, max: 2, def: 1 },
  { key: 'lash', label: 'まつげの張り出し（横向きで、奥の目尻のまつげが輪郭の外へ出る）', min: 0, max: 1.5, def: 0 },   // 0 で無し（まつげも目と一緒に縮む）
];
// 瞳の動き。まばたきのあとのぷるん・うるみ（ゆらめき）・視線のはずみの強さ（0 で無し、1 が標準）
const EYE_TUNE = [
  { key: 'puru', label: '瞳のぷるん', min: 0, max: 2, def: 1 },
  { key: 'lens', label: '瞳の中のふくらみ', min: 0, max: 2, def: 1 },
  { key: 'shimmer', label: '瞳のうるみ', min: 0, max: 2, def: 1 },
  { key: 'gazeBounce', label: '視線のはずみ', min: 0, max: 2, def: 1 },
];
const target = {}, cur = {}, tune = {}, eyeTune = {};
for (const t of EYE_TUNE) eyeTune[t.key] = t.def;
for (const p of PARAMS) target[p.key] = cur[p.key] = p.def;
for (const t of TUNE) tune[t.key] = t.def;
// 使う人の好み（操作パネルの「好みに合わせる」）。キャラの初期値（髪の揺れ・揺れ物の大きさ・体の動き・瞳の動き）に掛ける倍率。
// 1 なら、キャラを作った人が決めた動きのまま（キャラの初期値とは別に、モデルごとにブラウザへ保存する）
const USER_ITEMS = [
  { key: 'sway', label: '髪と飾りの揺れ', min: 0, max: 1.5, def: 1, step: 0.05 },
  { key: 'body', label: '体の動き（呼吸・ゆれ）', min: 0, max: 1.5, def: 1, step: 0.05 },
  { key: 'puru', label: '瞳のぷるん', min: 0, max: 1.5, def: 1, step: 0.05 },
];
const USER = {}; for (const u of USER_ITEMS) USER[u.key] = u.def;
// URL の set=（JSON）で、調整の値をまとめて渡せる（「OBS 用の URL をコピー」が作る。ブラウザに保存した値より優先）
const URLSET = (() => { try { return JSON.parse(q.get('set') || 'null') || {}; } catch (e) { return {}; } })();
const urlNum = (group, key, cur, min, max) => { const v = (URLSET[group] || {})[key]; return typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : cur; };

// 表情プリセット。eyeMul は目の開きに掛ける倍率、ほかは足し込み
// 口は、口角の上がり下がり（mouthForm）だけで表す。口の開き・幅・位置は、通常のまま変えない
// （前は表情ごとに口を開けたり幅を詰めたりしていて、口の位置と大きさが通常からずれて見えた）
const EXPR = {
  '通常': {},
  'にこ': { eyeSmile: 1, eyeMul: 0, mouthForm: 0.42 },
  '笑顔': { eyeSmile: 1, eyeMul: 0, mouthForm: 0.55, browY: 0.25 },
  '閉じ目': { eyeMul: 0 },
  '怒り': { browAngle: 1, browY: -0.4, browShow: 1, mouthForm: -0.65, eyeMul: 0.86 },
  '蔑む': { diffs: ['蔑む', '闇'], eyeMul: 0.82, browShow: 1, browAngle: 0.35, browY: -0.3, mouthForm: -0.4 },
  '青ざめ': { diffs: ['青ざめ', '涙'], mouthForm: -0.25, browAngle: -0.8, browShow: 0.6 },
  '照れ': { diffs: ['赤面'], mouthForm: 0.22, browAngle: -0.3 },
  'ハート': { diffs: ['赤面', 'ハート'], mouthForm: 0.30 },
  'キラキラ': { diffs: ['しいたけ'], mouthForm: 0.48, browY: 0.4 },
  'ぐるぐる': { diffs: ['ぐるぐる', '汗'], mouthForm: -0.55, browAngle: -0.8, browShow: 0.6 },
  '闇': { diffs: ['黒', '闇'], mouthForm: 0.28, eyeMul: 0.9 },
  // 口の線の形だけを変える表情（口の位置・幅は通常のまま）
  'ω': { mouthWave: 1, mouthForm: 0.12 },
  'てへ': { diffs: ['赤面'], mouthTongue: 1, mouthForm: 0.28, browAngle: -0.3 },
};
const EX_KEYS = ['eyeSmile', 'eyeNarrow', 'browY', 'browAngle', 'browShow', 'mouthOpen', 'mouthForm', 'mouthWave', 'mouthTongue', 'eyeTilt', 'eyeJito', 'eyeShut', 'irisSize', 'cheek', 'browForm'];
const ex = { eyeMul: 1, mouthWidth: 1, eyeMulR: 1, eyeMulL: 1 };
for (const k of EX_KEYS) ex[k] = 0;
const diffW = {};   // 差分レイヤーの濃さ（なめらかに追従した値）
let exprName = '通常';
// 表情の切り替わり。全部を同じ速さで動かすと機械的に見えるので、目 → まゆ → 口角 の順に少しずつ遅らせ、
// まゆと口角は、ばねで少し行きすぎてから落ち着かせる（t 遅れ(秒)、f 速さ(Hz)、d 止まりやすさ）。強さは tune.exprLive（0 で前と同じ）
const EX_DYN = {
  eyeSmile: { t: 0, f: 5, d: 0.9 }, browShow: { t: 0, f: 5, d: 1 }, mouthOpen: { t: 0.06, f: 4, d: 0.8 },
  browY: { t: 0.035, f: 4.2, d: 0.5 }, browAngle: { t: 0.035, f: 4.2, d: 0.55 }, mouthForm: { t: 0.09, f: 3.6, d: 0.5 },
};
const exV = {}, exFrom = {};
let exprT0 = -1e9, exprPrev = '通常', nowT = 0;
const IRIS_DIFF = /ハート|しいたけ|ぐるぐる|闇|黒/;

let mode = q.get('mode') || 'mouse';
let mirror = true;
const status = (t) => { $('#status').textContent = t; };

// ---- 読み込み --------------------------------------------------------------
// モデルの名前。URL の ?model=名前 で切り替える（models/<名前>/ を読む。既定は kurage02）
const MODEL_NAME = (q.get('model') || 'kurage02').replace(/[^A-Za-z0-9_\-]/g, '');
const MODEL_DIR = 'models/' + MODEL_NAME;
const model = await (await fetch(MODEL_DIR + '/model.json')).json();
// BOXP-716（kohako-studio の試作）: 親の画面（同じ origin）が置いた KOHAKO_K2D から、層の動き・絵・毎コマの処理を足す。無ければ元のまま。
const EXT = (() => { try { return window.parent !== window ? window.parent.KOHAKO_K2D || null : null; } catch { return null; } })();
// モデルごとの調整の初期値（model.json の tune）。あれば既定値を置き換える。「調整を初期値に戻す」もこの値へ戻る
// モデルごとの「表情・向き」の初期値（model.json の params。口の形・口の幅など）
if (model.params) for (const p of PARAMS) if (typeof model.params[p.key] === 'number') { p.def = Math.min(p.max, Math.max(p.min, model.params[p.key])); target[p.key] = cur[p.key] = p.def; }
if (model.eyeTune) for (const t of EYE_TUNE) if (typeof model.eyeTune[t.key] === 'number') { t.def = Math.min(t.max, Math.max(t.min, model.eyeTune[t.key])); eyeTune[t.key] = t.def; }
if (model.tune) for (const t of TUNE) if (typeof model.tune[t.key] === 'number') { t.def = Math.min(t.max, Math.max(t.min, model.tune[t.key])); tune[t.key] = t.def; }
if (model.keyEye || model.keyMouth) {
  // 目: eyeSmile 笑い（開いたままなら細めた目、閉じると ⌒）、eyeTilt 傾き（− 困り / + にらみ）、eyeJito ジト目、eyeShut ぎゅっと閉じる、eyeMul 開き（1.2 で見開き）、
  //     eyeMulR・eyeMulL 片目ずつ（R が画面左）、irisSize 瞳の大きさ。眉: browY・browAngle（+ 怒り / − 困り）・browForm。cheek ほほの赤み。mouth 口のキーの重み
  Object.assign(EXPR, {
    'にこ': { eyeSmile: 1, cheek: 0.35, browY: 0.15, mouth: { closed: 1 } },
    '笑顔': { eyeSmile: 1, eyeMul: 0, cheek: 0.5, browY: 0.3, browForm: 0.3, mouth: { laugh: 1 } },
    'わーい': { eyeMul: 1.15, browY: 0.55, cheek: 0.45, mouth: { tri: 1 } },
    'にしし': { eyeSmile: 1, eyeMul: 0, cheek: 0.5, browY: 0.2, mouth: { grin: 1 } },
    'にやり': { eyeMul: 0.62, eyeTilt: 0.35, browAngle: 0.35, browY: -0.15, cheek: 0.3, mouth: { smug: 1 } },
    'ウインク': { eyeMulR: 0, eyeSmile: 1, cheek: 0.4, browY: 0.2, mouth: { grin: 1 } },
    '閉じ目': { eyeMul: 0 },
    'びっくり': { eyeMul: 1.2, irisSize: -0.6, browY: 0.8, mouth: { round: 1 } },
    'ぽかん': { eyeMul: 1.1, browY: 0.35, mouth: { u: 1 } },
    'ジト目': { eyeJito: 1, browY: -0.3, browAngle: 0.2, mouth: { pout: 1 } },
    '怒り': { eyeTilt: 1, browAngle: 1, browY: -0.45, mouth: { he: 1 } },
    '困り': { eyeTilt: -1, browAngle: -0.9, browY: 0.1, cheek: 0.2, mouth: { wavy: 1 } },
    'ω': { cheek: 0.2, mouth: { omega: 1 } },
    '照れ': { diffs: ['赤面'], eyeSmile: 0.7, browAngle: -0.3, mouth: { omega: 1 } },
    '蔑む': { diffs: ['蔑む', '闇'], eyeJito: 0.8, browAngle: 0.35, browY: -0.3, mouth: { he: 1 } },
    '青ざめ': { diffs: ['青ざめ', '涙'], eyeTilt: -0.8, browAngle: -0.8, mouth: { wavy: 1 } },
    'ハート': { diffs: ['赤面', 'ハート'], mouth: { small: 1 } },
    'キラキラ': { diffs: ['しいたけ'], eyeMul: 1.1, browY: 0.4, mouth: { a: 1 } },
    'ぐるぐる': { diffs: ['ぐるぐる', '汗'], browAngle: -0.8, mouth: { square: 1 } },
    '闇': { diffs: ['黒', '闇'], eyeMul: 0.9, mouth: { closed: 1 } },
  });
  EXPR['てへ'] = { diffs: ['赤面'], eyeMulR: 0, eyeSmile: 1, browAngle: -0.3, mouth: { smug: 1 } };
  if (model.expr) Object.assign(EXPR, model.expr);   // キャラごとの足し・上書き（char.json の expr）
}
const LAYERS = model.layers;
const byName = {};
for (const L of LAYERS) byName[L.name] = L;
status('画像を読み込み中…');
await Promise.all(LAYERS.map((L) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => { L.img = im; resolve(); };
  im.onerror = () => reject(new Error('画像を読み込めません: ' + L.src));
  const sub = EXT && EXT.image ? EXT.image(L) : null;   // BOXP-716: 親が加工した絵（座り姿の太もも）に差し替える
  if (sub) { sub.then((c) => { L.img = c; resolve(); }, reject); return; }
  im.src = MODEL_DIR + '/parts/' + L.src;
})));
// PSD のクリッピング（服の影はシャツの形で切る）は、動きが同じなので読み込み時に焼き込む
function bakeClip(L, base) {
  if (!L || !base) return;   // そのレイヤーが無いモデル（体のレイヤーを、別の名前の絵に置き換えたキャラなど）では、何もしない
  const c = document.createElement('canvas');
  c.width = L.w; c.height = L.h;
  const x = c.getContext('2d');
  x.drawImage(L.img, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(base.img, base.x - L.x, base.y - L.y);
  L.img = c;
}
bakeClip(byName['カーディガン影R'], byName['シャツ']);
bakeClip(byName['カーディガン影L'], byName['シャツ']);

// ---- WebGL -----------------------------------------------------------------
const view = $('#view');
const gl = view.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
if (!gl) { status('WebGL2 が使えません'); throw new Error('no webgl2'); }
const prog = (() => {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es
    in vec2 aPos; in vec2 aUV; out vec2 vUV; out vec2 vScr; uniform vec4 uView; // 中心x, 中心y, 1/半幅x, 1/半幅y
    void main(){ vec2 p = vec2((aPos.x - uView.x) * uView.z, -(aPos.y - uView.y) * uView.w);
      vUV = aUV; vScr = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; in vec2 vUV; in vec2 vScr; out vec4 o;
    uniform sampler2D uTex; uniform sampler2D uMask; uniform float uAlpha; uniform int uMode; // 0 通常 1 乗算 2 マスク描き込み
    uniform vec4 uSel1; uniform vec4 uSel2; uniform vec3 uTint;
    void main(){
      vec4 c = texture(uTex, vUV);
      c.rgb *= uTint;
      if (uMode == 2) { o = vec4(c.a * uAlpha); return; }
      float f = 1.0;
      vec4 m = texture(uMask, vScr);
      if (dot(uSel1, vec4(1.0)) > 0.5) f *= dot(m, uSel1);
      if (dot(uSel2, vec4(1.0)) > 0.5) f *= dot(m, uSel2);
      c *= uAlpha * f;
      if (uMode == 1) o = vec4(vec3(1.0 - c.a) + c.rgb, 1.0); else o = c;
    }`));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aUV');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
})();
gl.useProgram(prog);
const U = {};
for (const n of ['uView', 'uTex', 'uMask', 'uAlpha', 'uMode', 'uSel1', 'uSel2', 'uTint']) U[n] = gl.getUniformLocation(prog, n);
gl.uniform3f(U.uTint, 1, 1, 1);
gl.uniform1i(U.uTex, 0);
gl.uniform1i(U.uMask, 1);
gl.enable(gl.BLEND);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

function makeTexture(source) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
const WHITE = (() => { const c = document.createElement('canvas'); c.width = c.height = 2; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2, 2); return makeTexture(c); })();

// 頂点を毎フレーム書き換えるメッシュ
function makeMesh(pos, uv, idx) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const pb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ub = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ub);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
  return { vao, pb, ub, ib, pos, uv, count: idx.length };
}
function uploadPos(m) { gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos); }
function gridMesh(L, cell) {
  const nx = Math.max(2, Math.ceil(L.w / cell)), ny = Math.max(2, Math.ceil(L.h / cell));
  const n = (nx + 1) * (ny + 1);
  const rest = new Float32Array(n * 2), uv = new Float32Array(n * 2), idx = [];
  for (let j = 0, k = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++, k++) {
      rest[k * 2] = L.x + (L.w * i) / nx; rest[k * 2 + 1] = L.y + (L.h * j) / ny;
      uv[k * 2] = i / nx; uv[k * 2 + 1] = j / ny;
      if (i < nx && j < ny) idx.push(k, k + 1, k + nx + 1, k + 1, k + nx + 2, k + nx + 1);
    }
  }
  const m = makeMesh(new Float32Array(n * 2), uv, new Uint16Array(idx));
  m.rest = rest; m.n = n;
  return m;
}
// 短冊や四角を毎フレーム作り直す用（口）
function stripMesh(maxVerts) {
  const m = makeMesh(new Float32Array(maxVerts * 2), new Float32Array(maxVerts * 2), new Uint16Array(maxVerts * 3));
  m.idx = new Uint16Array(maxVerts * 3);
  return m;
}
function uploadAll(m, nv, ni) {
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos, 0, nv * 2);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.ub); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.uv, 0, nv * 2);
  gl.bindVertexArray(m.vao);
  gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, m.idx, 0, ni);
  m.count = ni;
}

// ---- 頭の立体と姿勢 --------------------------------------------------------
// 顔の各点に奥行き z（画面手前が +）を持たせ、首の軸まわりに
// 本当に 3D 回転させてから正面へ投影する:  x' = x cosθ + z sinθ
// 奥行きの目安は（顔の半幅を R として）目 0.75R・眉 0.94R・鼻 1.2R・口 0.88R・あご先 0.74R。
// 奥行きが違うので、鼻＞眉＞目≒口＞あご の順に大きく動く。
const HX = model.curves.face.cx;       // 顔の中心線（回転軸の x）
const PY = 820;                        // 上下の回転軸の高さ = 目・耳の高さ（ここを軸にすると、上でも下でも顔が縮む）
const FACE_TOP = model.curves.face.y0, FACE_H = model.curves.face.R.length;
const PIV = [1500, 1140];              // かしげの回転中心
const pose = { sinY: 0, cosY: 1, sinP: 0, cosP: 1, sr: 0, cr: 1, ox: 0, oy: 0, down: 0 };
const body = { breath: 0, sway: 0, roll: 0, act: 0, tw: 0, sh: 0, sv: 0, sx: null, rv: 0, rx: null, tv: 0, hb: 0 };
const FACE_ROWS = model.curves.face, R0 = Math.max(...FACE_ROWS.R);
const knots = (pts) => (y) => {         // なめらかな折れ線
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], sstep(pts[i - 1][0], pts[i][0], y));
  return pts[pts.length - 1][1];
};
// 顔の面の変形。Live2D のワープデフォーマと同じ考え方で、面全体を「なめらかな 1 つの変形」として動かす。
// ある高さ y の断面を「半幅 R、中心の奥行き Zc、端の奥行き Z0」で表し、横向きのずれを次の和にする:
//   (1) 奥行きによるずれ   z(u)·sinθ      z(u) = Z0 + (Zc - Z0)·(1 - |u|^1.5)   u = (x - 中心)/R
//   (2) 手前側の端の引っ込み  R·(1 - cosθ)   手前の端で最大、奥の端で 0
// 奥の端はほぼ動かず、中央が大きく動くので、奥半分は一様に詰まり、手前半分は伸びる。
// 元の輪郭をなめらかな式で写すだけなので、輪郭の形は崩れない（前の版は行ごとに稜線を解いていて、こぶができた）。
// 顔の端から EDGE_BAND px の帯は伸び縮みさせず端と一緒に動かす（輪郭線の太さを保ち、線と肌のふちをずらさない）
const EDGE_BAND = 44;
// tune.faceDown の調整値（?fdA= などで試せる）。a・b: ほお骨の高さ（745）と、ほほの下（880）の、端の奥行き（R0 の倍率）。
// k: 斜め下で、奥の端を、向きに応じて深くする量（奥の輪郭は、ほほの前の面でできる。R0·sin(左右) の倍率）。g: 斜め下での、奥のほほのふくらみの足し
// s: 左右の向きに対する、k・g の立ち上がりの速さ（小さいほど、少し横を向いただけで効く。目は、少し横を向いただけで、奥の輪郭へ寄るので、
// 向きの sin に比例させると、左右 10〜20°のときに、いちばん余裕が小さくなった）
const FD = { a: q.has('fdA') ? +q.get('fdA') : 0.5, b: q.has('fdB') ? +q.get('fdB') : 0.72, k: q.has('fdK') ? +q.get('fdK') : 0.8, g: q.has('fdG') ? +q.get('fdG') : 0.14, s: q.has('fdS') ? +q.get('fdS') : 0.25 };
let z0pFn = null;
const SKIN = {
  R: (y) => { const f = clamp(y - FACE_ROWS.y0, 0, FACE_ROWS.R.length - 1), i = Math.min(Math.floor(f), FACE_ROWS.R.length - 2); return Math.max(lerp(FACE_ROWS.R[i], FACE_ROWS.R[i + 1], f - i) - EDGE_BAND, 6); },
  Zc: knots([[111, 0], [300, 0.8 * R0], [582, 1.02 * R0], [820, 0.98 * R0], [945, 1.15 * R0], [1020, 1.0 * R0], [1167, 0.8 * R0]]),
  Z0: (y) => 0.8 * R0 * Math.pow(clamp((y - 880) / 287, 0, 1), 1.3),   // 頬の高さから下は、あご先へ向かって前に出る（横を向くと、幅を保ったまま向いた側へずれる）
  Z0P: (y) => (z0pFn || (z0pFn = knots([[586, 0], [745, -0.6 * R0], [871, -0.75 * R0], [1019, 0], [1167, PITCH.chinUp * R0]])))(y),
  Z0D: knots([[745, 0], [880, 0.1 * R0], [980, 0.85 * R0], [1167, 0.95 * R0]]),
  // tune.faceDown のときの、下向きの端の奥行き: こめかみから下を、なだらかに深くする（ほお骨のあたりで 0.4〜0.6·R0）。
  // 上の Z0D は、ほお（745〜880）がほとんど動かず、その下（880〜980）だけが 2 倍に伸びるので、下を向くと、顔のいちばん広い所が上に残り、
  // 目（150 画素 下がる）が、あごへ向かって細くなる所まで来て、白目の外の端が、輪郭の外へ出た
  Z0D2: knots([[600, 0], [745, FD.a * R0], [880, FD.b * R0], [980, 0.85 * R0], [1167, 0.95 * R0]]),
  crown: true,
  band: EDGE_BAND, k: 1,
  bulge: (y) => 0.17 + 0.1 * Math.exp(-(((y - 960) / 170) ** 2)),
};
// 髪の殻。前髪は顔と同じように動き、顔の横（もみあげ）へ行くほど奥行きが小さい。
// 後ろ髪は頭の後ろ側（奥行きがマイナス）なので、顔と逆向きに動く。
// 半幅を高さによらず一定にしてあるので、縦に垂れた房は上から下まで同じだけ動く（途中で曲がらない）
const crown = (r) => (y) => (y < 300 ? r * Math.sqrt(Math.max(0.04, 1 - ((300 - y) / 262) ** 2)) : r);
// model.json の hatDome（書かなければ、無し = 前と同じ。true か、値を書いた {}。?hatDome=1 で試せる）: 帽子を、丸いドームとして動かす
// （てっぺんほど、頭の回る軸に近く、前のふちほど、手前にある）。前は、帽子の全部が、同じ奥行きの 1 枚の板だった:
//   下を向くと、てっぺんが大きく下がって、前のふちは少ししか下がらず、ドームが平たくつぶれて、ふちの下に、髪が長くのぞいた（上から見えるはずの、帽子の上の面が、見えてこない）。
//   上を向くと、前髪が、ふちの下へ潜った。左右を向くと、前のふちが、その下の前髪より遅れて動いた（帽子が、髪より奥にあるように見えた）。
//   top・brim      下を向いたときの奥行き（R0 の倍率）: 帽子のてっぺん / 前のふち。ふちは、その下の前髪より、少し余分に下がる（帽子が、額にかぶさる）
//   upTop・upBrim  上を向いたときの奥行き。差を小さくしてある（下から見ると、ドームは平たく見えるが、帽子の裏は描けないので、つぶしすぎない）
//   yawTop・yawBrim  左右を向いたときの奥行き。前のふちは、その下の前髪と、ほぼ同じだけ動く
//   at             前のふちの高さ（帽子の絵の高さに対する割合。上の端が 0）。p: てっぺんからふちへの、奥行きの立ち上がり（大きいほど、てっぺんの近くで急に深くなる）
// model.json の hatParts（書かなければ、無し = 前と同じ）: 帽子の絵を、重ね順の違う何枚かに分けたモデル（ヘッドホンのバンドは髪の上・カップは横の房の奥、など）。
// どれも同じ面（SHELL.hat）で動かすので、分けた所のつなぎ目は、ずれない。ドームの高さ（y0・h）は、分けた全部を合わせた範囲で決める
// （分けないモデルは、前と同じく、最初の 1 枚の範囲）
const HAT_L = (() => {
  const a = LAYERS.filter((L) => L.path === '頭/帽子');
  if (!Array.isArray(model.hatParts) || a.length < 2) return a[0];
  const b = a.filter((L) => L.name === '帽子' || model.hatParts.includes(L.name));
  if (b.length < 2) return a[0];
  const y0 = Math.min(...b.map((L) => L.y)), y1 = Math.max(...b.map((L) => L.y + L.h));
  return { y: y0, h: y1 - y0 };
})();
const HD = (() => {
  const d = q.has('hatDome') ? (+q.get('hatDome') ? {} : null) : model.hatDome === true ? {} : (model.hatDome || null);
  if (!d || !HAT_L) return null;
  const num = (k, def) => (q.has('hd_' + k) ? +q.get('hd_' + k) : typeof d[k] === 'number' ? d[k] : def);
  const o = { top: num('top', 0.12), brim: num('brim', 1.0), upTop: num('upTop', 0.6), upBrim: num('upBrim', 0.95), yawTop: num('yawTop', 0.3), yawBrim: num('yawBrim', 0.78), p: num('p', 1.8) };
  o.y0 = HAT_L.y; o.h = Math.max(1, HAT_L.h * num('at', 0.75));
  o.f = (y) => 1 - Math.pow(1 - clamp((y - o.y0) / o.h, 0, 1), o.p);   // 0（てっぺん）〜 1（前のふちから下）
  return o;
})();
const zero = () => 0;
const shell = (r, zc, k) => ({ R: crown(r), Zc: (y) => zc * R0 * sstep(40, 420, y), Z0: zero, band: 0, k, bulge: () => 0.1 });
const SHELL = {
  bangs: shell(440, 1.1, 1), side: shell(508, 1.1, 0.2), cap: shell(508, -0.1, 1),
  back1: shell(508, -0.3, 1), back2: shell(508, -0.5, 1), bun: shell(508, -0.25, 1),
  // 房モデル用: 半幅を広く取り、頭頂から前髪・横髪にかけて奥行きが急変しないようにする（横向き時の途中ゆがみを防ぐ）
  // 前の髪（前髪・横髪・前髪下地）は同じ殻を使い、横向きで房どうしがずれてすき間が開かないようにする
  clumpFront: { R: () => 640, Zc: (y) => lerp(0.55, 0.90, sstep(40, 620, y)) * R0, Z0: zero, band: 0, k: 1, bulge: () => 0.08 },
  clumpBack:  { R: () => 680, Zc: (y) => lerp(-0.22, -0.46, sstep(40, 620, y)) * R0, Z0: zero, band: 0, k: 1, bulge: () => 0.08 },
  // 帽子: 上から下まで同じ奥行き・広い半幅（クラゲの傘・垂れの端まで歪まず一体で頭と一緒に動く）
  hat: HD ? { R: () => 960, Zc: (y) => lerp(HD.yawTop, HD.yawBrim, HD.f(y)) * R0, Z0: zero, band: 0, k: 1, bulge: () => 0.05,
    // 上向きと下向きで、奥行きが違う。正面を通るとき、動く速さが急に変わらないように、正面の近く（上下 約 4°）で、なめらかに切り替える
    ZP: (y) => { const f = HD.f(y); return lerp(lerp(HD.top, HD.brim, f), lerp(HD.upTop, HD.upBrim, f), sstep(-0.07, 0.07, pose.sinP)) * R0; } }
    : { R: () => 960, Zc: () => 0.50 * R0, Z0: zero, band: 0, k: 1, bulge: () => 0.05 },
};
// 上下の向きの調整値（?pTop= などで試せる）
//   top: 下向きで頭頂を下げる量（0 にすると頭頂が残り、頭が縦に伸びて見える = 頭のてっぺんが見えてくる）
//   upK / downK: 目・眉・鼻・口が頭の中で上下に滑る量の倍率
//   chinUp: 上向きであご先が上がる量（奥行き、R0 の倍率）
const PITCH = { top: q.has('pTop') ? +q.get('pTop') : 0.0, upK: q.has('pUpK') ? +q.get('pUpK') : 1.3, downK: q.has('pDownK') ? +q.get('pDownK') : 1.35, chinUp: q.has('pChin') ? +q.get('pChin') : 0.35 };
// 斜めを向いたときの、顔の中心線の傾き（tune.headTilt）。
// 前は、左右の位置が、上下の向きによらなかった（左右へ回してから、画面の横軸で上下に回す順）。斜め下では、目・口・あご先が、正面と同じ縦の並びのまま横へ動き、
// 目より、あごと口が先へ出て、あごのしゃくれた顔に見える。
// ねらい（目安の値）: あご先に対する両目の中点は、真横で 0、下を向くと +0.20E 先へ（E = 両目の間隔）、上を向くと −0.12E。
// 頭を、先に上下へ回してから左右へ回す（頭を立体として回す）と、高さ y の点は、奥行きが (y − 支点)·sinP だけ変わり、横へ (y − 支点)·sinP·sinY ずれる。
// 支点は、あご先（あご先は、上下を向いても、ほぼ動かさない。首とのつなぎ目も変わらない）。強さ TILT_K は、目安の大きさに合わせた（剛体の 0.6 倍）
const TILT_K = q.has('tiltK') ? +q.get('tiltK') : 0.6, TILT_Y0 = FACE_TOP + FACE_H - 1;
let tiltT = 0;                           // 今の姿勢の傾き（高さ 1 あたりの、横のずれ）。毎フレーム、姿勢と一緒に決める
const sm = [0, 0];
function surfMap(S, x, y, out) {
  const R = S.R(y), dx = x - HX;
  const u = clamp(dx / R, -1, 1), over = dx - u * R;
  const sY = pose.sinY, as = Math.abs(sY), sg = sY < 0 ? -1 : 1, us = u * sg;   // us: -1 手前の端 … +1 奥の端
  const z0 = S.Z0(y) * S.k * tune.depth;
  let A = (S.Zc(y) - S.Z0(y)) * S.k * tune.depth;
  // 面が折り返さない上限。幅が狭いところ（頭のてっぺん・あご先）では奥行きの差も小さくする。
  // これがないと、てっぺんで中央だけが飛び出して切れ込みになる
  const lim = Math.min((0.8 * R) / (1.5 * Math.max(as, 1e-4)), 1.2 * R);
  if (A > lim) A = lim; else if (A < -lim) A = -lim;
  const bell = 1 - Math.pow(Math.abs(u), 1.5);
  const z = z0 + A * bell;
  const near = Math.pow((1 - us) / 2, 1.5), far = ((1 + us) / 2) ** 2;
  // 上下用の奥行き（輪郭の端だけ別の値。中央は同じ）
  let zP = z, fdG = 0;
  if (S.Z0P) {
    let e = pose.down > 0 && S.Z0D ? S.Z0D(y) : S.Z0P(y);
    if (tune.faceDown > 0 && pose.down > 0 && S.Z0D && S.Z0D2) {   // 下向きで、ほほの輪郭を、目と一緒に下げる（斜め下では、奥のほほを、さらに下げてふくらませる）
      const fw = sstep(600, 760, y) * (1 - sstep(980, 1120, y)) * far, asF = 0.5 * Math.tanh(as / FD.s) / Math.tanh(0.5 / FD.s);
      e = lerp(e, S.Z0D2(y), Math.min(tune.faceDown, 1)) + tune.faceDown * FD.k * R0 * asF * fw;
      fdG = tune.faceDown * FD.g * -pose.sinP * fw * asF;
    }
    e *= tune.depth;
    const Ap = clamp(S.Zc(y) * tune.depth - e, -1.2 * R, Math.max(1.2 * R, A)); zP = e + Ap * bell;
  }
  if (S.ZP) zP = S.ZP(y) * S.k * tune.depth * bell;   // 上下だけ、別の奥行き（帽子のドーム。model.json の hatDome）
  const topW = S.crown ? 1 - sstep(FACE_TOP + 0.06 * FACE_H, FACE_TOP + 0.41 * FACE_H, y) : 0;
  const crownX = sg * as * R0 * topW * 0.2;
  // (3) 奥側の端のふくらみ: 奥を向いた側は頬の丸みが輪郭になるので、少し外へ出る（最大 +0.11R）
  out[0] = HX + u * R + over + z * sY + sg * (R + S.band) * ((1 - pose.cosY) * near + S.bulge(y) * as * far * (1 - topW) + fdG * (1 - topW)) + crownX + tiltT * (y - TILT_Y0);
  out[1] = pitchY(y, zP * pose.cosY);
}
// 上下の回転。軸は目の高さ。上を向くと手前（奥行き +）は上がり、後ろ（耳）は下がる
function pitchY(y, z1) {
  if (pose.down > 0 && z1 < 0) z1 = 0;                      // 下向きでは、後ろ側は下がったままにしない（耳は動かない）
  const topDrop = pose.down * PITCH.top * FACE_H * (1 - sstep(FACE_TOP, FACE_TOP + 0.3 * FACE_H, y));
  return PY + (y - PY) * pose.cosP - z1 * pose.sinP + topDrop;
}
// 奥行き z が決まっている点の回転
function rotMap(x, y, z, out) {
  const dx = x - HX;
  out[0] = HX + dx * pose.cosY + z * pose.sinY + tiltT * (y - TILT_Y0);
  out[1] = pitchY(y, z * pose.cosY * (pose.sinP > 0 ? PITCH.upK : PITCH.downK));
}
// かしげの回転と、体に乗っている分の移動
function headPose(out) {
  const rx = out[0] - PIV[0], ry = out[1] - PIV[1];
  out[0] = PIV[0] + rx * pose.cr - ry * pose.sr + pose.ox;
  out[1] = PIV[1] + rx * pose.sr + ry * pose.cr + pose.oy;
}
// 体。下端（腰）を支点に、絵を歪ませず穏やかな剛体回転と呼吸の上下だけで自然に動かす
const BODY_BOTTOM = model.yMax;
function bodyT(x, y, out) {
  const k = clamp((BODY_BOTTOM - y) / 1200, 0, 1.3);
  const dx = x - 1500, dy = y - BODY_BOTTOM;
  const cr = Math.cos(body.roll), sr = Math.sin(body.roll);
  // 体の左右ひねり歪み（tw）や強い斜めシアーは入れず、ごく軽い平行追従＋剛体回転＋呼吸の上下のみ
  // ※ body.sway 自体は stepPhys のアクセサリー揺れ駆動のため維持する
  const sx = body.sway * 0.18 * Math.min(k, 1);
  out[0] = 1500 + dx * cr - dy * sr + sx + dx * 0.003 * body.breath * k;
  out[1] = BODY_BOTTOM + dx * sr + dy * cr - body.breath * 6 * k - body.act * Math.min(k, 1) - body.sh * Math.min(Math.abs(dx) / 600, 1.0) * Math.min(k, 1) * 0.5;
}

// 目・眉・口・鼻などの「パーツ」。絵は曲げない。基準点を 3D 回転で動かし、形には、向きに応じた縮みだけを掛ける。
//   z    基準点の奥行き。数値なら固定、面 S を渡すとその面の上の位置になる
//   zx   横向きのときの幅の変わり方。幅の倍率 = cosθ ∓ zx·sinθ（奥側で縮み、手前側で広がる）
// 目安（約 41°）: 目 手前 ×1.05・奥 ×0.59 → zx 0.35 / 眉 ×1.19・×0.55 → zx 0.5 / 口 ×0.7 → zx 0
//   opt.lead  横向きで、基準点を余分にずらす割合（奥行きを lead 倍ぶん深く見せる。tune.solid が掛かる）
//   opt.asym  横向きで、基準点より奥の側を詰め、手前の側を伸ばす強さ。opt.aw は、その切り替わりの幅(px)
//             （丸い面に乗った物は、向いた側の半分が詰まって見える。左右の上限が小さくても立体に見えるよう、実際より強めに掛ける）
//   opt.fit   [上向き, 下向き] の「上下の動きだけの奥行き」。tune.faceFit の割合で、z の代わりに使う（鼻と口。目の zPitch と同じ式）。
//             z のままだと、鼻（1.25）と口（0.92）は、目（0.75）より深いうえに倍率（upK・downK）も掛かり、目の 1.6〜2.2 倍 上下に滑る。
//             上限が 5°のころは「立体に見える」味付けだったが、上 16°・下 28°まで広げると、上向きで鼻が目の高さへ上がり、下向きで鼻が口に重なる。
//             斜めでは、左右のずれ（鼻は、奥の目の下まで行く）と重なって、鼻が目や口にぶつかる（顔が崩れて見える）。
//             目安: 下 26〜30°で、目〜口の間隔は 0.87〜0.89 倍（= 向きの cos。目と一緒に動く）、目〜鼻は 0.54〜0.6 倍。
//             鼻も口も、目より下へは滑らない。ここでは、目と同じ奥行き（間隔が cos で詰まるだけ）にする
const FIT_Z = 0.75 * R0;                 // 目の「上下の動き」の奥行き（makeEye の zPitch と同じ値）
//   opt.round 口の乗っている面の、左右の丸みの半径(px)。tune.mouthFit の割合で、asym の代わりに使う（口）。
//             asym は、基準点を境に、手前の側を伸ばし、奥の側を詰める。左右の上限が 14°のころに「立体に見える」よう、実際より強くした味付けで、
//             30°では、手前の半分が奥の半分の 3 倍になる（口角は、どちらも手前へずれ、口のまん中だけが残る）。笑った口は、底が奥へ寄って
//             奥の口角だけが跳ね上がり、開いた口は、底が向いた側へ突き出て、あごがしゃくれた人の口に見える。
//             丸い面に乗った物の、実際のずれは sinθ × (基準点からの距離)² ÷ (2 × 丸みの半径)。口の幅では、30°でも、手前の半分は奥の半分の 1.2 倍ほど。
//             ねらい: 左右 20°前後でも、口は、ほぼ左右対称のまま、位置が動いて幅が詰まるだけ
const MOUTH_ROUND = (q.has('mRound') ? +q.get('mRound') : 0.75) * R0;
//   opt.xz    目と眉を、左右にだけ余分に動かす奥行き(px)。tune.eyeFit の割合で足す。
//   opt.leadFit  口を余分にずらす割合（lead）の、目安に合わせた値。tune.mouthFit の割合で、lead から切り替わる。
//             目安の値（左右いっぱい。正面からのずれ ÷ 両目の間隔 E。向いた側が +）:
//               両目の中点 +0.506、あご先 +0.507（差 0）、口 +0.610（目より +0.104 先）、鼻 +0.821（+0.315 先）。目のずれを 1 とすると、口 1.20・鼻 1.62・あご先 1.00。
//             前のモデル（kurage02。30°）は、口 1.65・鼻 2.11・あご先 1.24: あご・口・鼻が、目より先へ出すぎ（= 目が遅れている）。
//             頭の輪郭を基準にすると、鼻とあご先は目安どおりで、目と眉が 0.074R（29 画素）遅れ、口が 0.033R（13 画素）出すぎ。
//             そこで、目と眉を xz ぶん先へ動かして、あご先の真上に置き、口は lead を小さくして、あご先より 0.078E（30°のとき）だけ先に置く
const EYE_XZ = (q.has('eyeXz') ? +q.get('eyeXz') : 0.154) * R0, MOUTH_LEAD_FIT = q.has('mLead') ? +q.get('mLead') : 0.077;
function makeGroup(ax, ay, z, zx, zPitch, opt) {
  const g = { ax, ay, p: [0, 0], sx: 1, sy: 1, sh: 0, A: 0, Q: 0, qk: 0, ql: 0, aw: (opt && opt.aw) || 1, px: opt && typeof opt.px === 'number' ? opt.px : ax };
  const side = ax < HX - 20 ? -1 : ax > HX + 20 ? 1 : 0;
  g.update = () => {
    if (typeof z === 'number') {
      rotMap(ax, ay, z * tune.depth, g.p);
      // 余分なずれは左右だけ（上下の動きは変えない）。口は、tune.mouthFit で、目安の位置（opt.leadFit）へ寄せる
      if (opt && opt.lead) g.p[0] += z * tune.depth * (typeof opt.leadFit === 'number' ? lerp(opt.lead, opt.leadFit, clamp(tune.mouthFit, 0, 1)) : opt.lead) * tune.solid * pose.sinY;
      if (opt && opt.xz && tune.eyeFit > 0) g.p[0] += opt.xz * tune.eyeFit * tune.depth * pose.sinY;   // 目と眉を、あご先に合わせて、左右にだけ余分に動かす
    }
    else surfMap(z, ax, ay, g.p);
    if (zPitch) g.p[1] = pitchY(ay, zPitch * tune.depth * pose.cosY * (pose.sinP > 0 ? 1 : PITCH.downK));   // 上下だけ別の奥行きで動かす
    if (opt && opt.fit && tune.faceFit > 0) g.p[1] = lerp(g.p[1], pitchY(ay, opt.fit[pose.sinP > 0 ? 0 : 1] * tune.depth * pose.cosY * (pose.sinP > 0 ? 1 : PITCH.downK)), Math.min(tune.faceFit, 1));
    g.sx = Math.max(0.35, pose.cosY - zx * side * pose.sinY);
    g.sy = pose.cosP;
    if (opt && opt.mouthPitch) {   // 口: 下向きで小さく（tune.mouthDownSize）、上下の向きで曲げる（tune.mouthPitchBend。口の半幅 opt.hw の割合）
      const ms = Math.max(0.5, 1 - tune.mouthDownSize * Math.max(0, -pose.sinP));
      g.sx *= ms; g.sy *= ms;
      g.mb = tune.mouthPitchBend * pose.sinP * opt.mouthPitch;
    }
    g.sh = 0.25 * pose.sinY * pose.sinP;   // 斜めを向いたとき、パーツの並びがほんの少し傾く
    g.A = opt && opt.asym ? clamp(opt.asym * tune.solid * pose.sinY, -0.7 * g.sx, 0.7 * g.sx) : 0;
    if (opt && typeof opt.pxR === 'number') g.px = pose.sinY > 0 ? opt.pxR : opt.px;   // 右を向くときだけ、別の軸（鼻の model.noseAxis = [左, 右]）
    // 顔の丸みのぶんのずれ（opt.round）。ql より外は、傾きを変えずにまっすぐ延ばす（面が折り返さない）
    g.qk = opt && opt.round ? clamp(tune.mouthFit, 0, 1) : 0;
    g.Q = g.qk > 0 ? tune.solid * pose.sinY / (2 * opt.round) : 0;
    g.ql = 0.3 * g.sx / Math.max(Math.abs(g.Q), 1e-9);
  };
  g.apply = (x, y, out) => {
    const lx = x - ax, ly = y - ay;
    let bx = 0;
    if (g.A) { const la = x - g.px; bx = g.A * la * la / Math.sqrt(la * la + g.aw * g.aw); }
    if (g.qk > 0) { const la = Math.abs(x - g.px), l2 = Math.min(la, g.ql); bx = lerp(bx, g.Q * l2 * (2 * la - l2), g.qk); }
    out[0] = g.p[0] + g.sx * lx - bx + tiltT * ly;   // パーツの中も、頭の全体と同じだけ傾ける（基準点だけ動かすと、目や口が、まわりの肌とずれる）
    out[1] = g.p[1] + g.sh * lx + g.sy * ly;
    if (g.mb) { const u = lx / opt.mouthPitch; out[1] += g.mb * u * u; }   // 口角ほど上下へ（下向き: sinP < 0 で上へ。g.mb は、口の半幅を掛けた画素）
    headPose(out);
  };
  return g;
}

// ---- 目 --------------------------------------------------------------------
// 目パチの絵を切り替える開き: [開いた目のパーツ, 目コマ2, 目コマ3, 目コマ4, 閉じ目]
const EYE_KEYS = [0.86, 0.68, 0.48, 0.22, 0];
function makeEye(c) {
  const n = c.U.length;
  const e = { xa: c.xa, xb: c.xb, n, U: Float32Array.from(c.U), L: Float32Array.from(c.L),
    Ut: new Float32Array(n), Lt: new Float32Array(n), Cc: new Float32Array(n), Cs: new Float32Array(n),
    open: 1, smile: 0, gx: 0, gy: 0 };
  const yT = Math.min(...c.U), yB = Math.max(...c.L), H = yB - yT;
  const y0 = (c.U[0] + c.L[0]) / 2, y1 = (c.U[n - 1] + c.L[n - 1]) / 2;
  // 閉じたときの線。u は目頭〜目尻を -1..1 とした位置（外側へ少しはみ出してもよい）
  // 清書した閉じ目（閉じ目R/L・笑い目R/L）があるモデルは、その絵の帯の位置を、閉じたときの線にする（開いた目のまつげが、その絵へ向かって下りる）
  const isR = c === model.curves.eyeR, bc = byName[isR ? '閉じ目R' : '閉じ目L'], bs = byName[isR ? '笑い目R' : '笑い目L'];
  const closedY = (u, smile) => {
    const base = lerp(y0, y1, (u + 1) / 2), arch = 1 - u * u;
    if (bc) {
      const yc = bc.y + bc.h * (0.36 + 0.3 * arch);   // 帯そのもの（端 0.15・まん中 0.75）より平らにする。途中で両端が立って見えないように
      const ys = bs ? bs.y + bs.h * (0.95 - 0.8 * arch) : base + H * (0.28 - 0.26 * arch);
      return lerp(yc, ys, smile);
    }
    return base + H * lerp(0.30 + 0.10 * arch,    // 閉じ目: 下まぶたの近くで浅くたるむ弧（∪）。目安の位置に合わせた
      0.28 - 0.26 * arch, smile);                 // 笑い目: 上へふくらむ弧（∩）
  };
  for (let i = 0; i < n; i++) { const u = (i / (n - 1)) * 2 - 1; e.Cc[i] = closedY(u, 0); e.Cs[i] = closedY(u, 1); }
  const lash = c.lash, xm = (c.xa + c.xb) / 2, xh = (c.xb - c.xa) / 2;
  // アイライン・まつげ用のずれ。線の下のふちが、閉じたときの線にぴったり乗るように動かす
  e.lineDy = (x) => {
    // 清書した閉じ目があるモデル: まつげを、上まぶたのなめらかな曲線（白目の上のふち）と同じだけ下ろす。目の幅の外（目尻のはね・目頭へ下がるまつげ）は、
    // 端の列と同じだけ動かす。まつげの下のふちは、はねや切り口でガタつくので、それを基準にすると、列ごとにずれ方が変わって塊になる
    if (bc) { const j = clamp(Math.round(x - e.xa), 0, n - 1); return e.Ut[j] - e.U[j]; }
    const i = clamp(Math.round(x - lash.xa), 0, lash.Y.length - 1);
    return (closedY(clamp((x - xm) / xh, -1.45, 1.45), e.smile) - lash.Y[i]) * (1 - e.open);
  };
  e.H = H;
  e.hasClosed = !!byName[c === model.curves.eyeR ? '閉じ目R' : '閉じ目L'];
  e.hasSmile = !!byName[c === model.curves.eyeR ? '笑い目R' : '笑い目L'];
  e.hasFrames = e.hasClosed && [2, 3, 4].every((k) => !!byName['目コマ' + k + (c === model.curves.eyeR ? 'R' : 'L')]);
  e.fw = new Float32Array(EYE_KEYS.length); e.ob = 1; e.nw = 0;
  e.hasNarrow = e.hasFrames && !!byName['目コマ6' + (c === model.curves.eyeR ? 'R' : 'L')];
  // 差分シートのあるモデルは、「にこ」と「笑顔」を別の顔にする（どちらも同じ「笑って閉じた目 + 口角」だと、同じ表情に見える）。
  // にこ = 笑って細めた目（開いたまま）+ 閉じた口。笑顔 = 笑って閉じた目 + 開いた口（口のコマがあるモデル）
  if (e.hasNarrow) EXPR['にこ'] = { eyeNarrow: 1, mouthForm: 0.2 };
  if (e.hasFrames && byName['口コマ2']) EXPR['笑顔'] = { eyeSmile: 1, eyeMul: 0, mouthOpen: 0.62, browY: 0.25 };
  e.cb = 0;
  e.group = makeGroup(c.iris[0], c.iris[1], 0.65 * R0, 0.55, 0.75 * R0, { xz: EYE_XZ });
  e.cx = c.iris[0]; e.cy = c.iris[1];
  // まつげの張り出し: 横を向くと、奥側の目は幅が縮む（顔の面に貼り付いた絵として縮む）。まつげは顔の面から立っている毛なので、
  // 目尻より外のまつげ（はね）は縮めず、もとの長さのまま外へ出す。顔の輪郭の線を越えて、外へはみ出して見える（手描きの絵と同じ）。
  // 白目と瞳には使わない（輪郭の外へ出ると変）。強さは tune.lash（0 で無し）
  e.side = c.iris[0] < HX ? -1 : 1;
  e.lashX = (x) => {
    if (!tune.lash) return x;
    const far = clamp(e.side * pose.sinY, 0, 1);
    if (far <= 0) return x;
    const corner = e.side < 0 ? e.xa + 0.12 * n : e.xa + 0.88 * n, d = (x - corner) * e.side;   // 目尻の少し内側から外
    if (d <= 0) return x;
    const k = lerp(1, 1 / Math.max(e.group.sx, 0.35), Math.min(tune.lash, 1.5) * sstep(0, 0.25, far));
    return corner + e.side * d * k;
  };
  // 瞳のぷるん。jx・jy は位置のゆれ(px。ばね)。px・py はまばたきのあとの伸び縮み（横・縦。0 が元の大きさ）、sh はうるみのゆらめき
  e.jig = { jx: 0, jy: 0, vx: 0, vy: 0, pgx: 0, pgy: 0, armed: false, t0: -9, px: 0, py: 0, sh: 0 };
  // 瞳の中のふくらみ（レンズ）の範囲。瞳の絵より少し広い だ円
  { const b = byName[c === model.curves.eyeR ? '瞳ベースR' : '瞳ベースL']; e.lrx = (b ? b.w / 2 : 78) * 1.12; e.lry = (b ? b.h / 2 : 78) * 1.12; }
  e.update = (open, smile, gx, gy) => {
    e.open = open; e.smile = smile; e.gx = gx; e.gy = gy;
    // 下まぶたは閉じきる直前まで動かさない（半目で瞳が下から削れないように）。笑い目のときは頬に押されて早めに上がる
    const o1 = Math.min(1, open * 3);
    e.lowOpen = o1;
    e.close = 1 - Math.min(open, 1);
    // 清書した閉じ目（閉じ目R/L・笑い目R/L）があるモデルは、閉じきる直前に、開いた目のパーツをそれと入れ替える。
    // 開いた目のまつげを変形するだけでは、目頭へ下がる長いまつげが塊になり、はねが太いまま残る（ねらいの、1 本の帯にならない）
    e.cb = e.hasClosed ? 1 - sstep(0.04, 0.12, open) : 0;
    // 差分シートの途中のコマ（目コマ2〜4。開きの 7 割・半分・2 割の絵）があるモデルは、まばたきを、アニメの目パチのように、
    // 描かれた絵を順に見せて作る（開いた目 → コマ 2 → 3 → 4 → 閉じた目）。となりの絵へは、短く重ねて切り替える
    // （片方が消えきる前に、もう片方を出しきる。両方を半透明にすると、下の肌が透ける。重ねる区間は短くして、止めたときは、ほぼいつも 1 枚の絵にする）。
    if (e.hasFrames) {
      const K = EYE_KEYS, o = Math.min(open, 1), W = e.fw;
      W.fill(0);
      if (o >= K[0]) W[0] = 1;
      else if (o <= 0) W[K.length - 1] = 1;
      else for (let i = 0; i < K.length - 1; i++) if (o <= K[i] && o >= K[i + 1]) {
        const t = (K[i] - o) / (K[i] - K[i + 1]);
        W[i] = 1 - sstep(0.5, 0.62, t); W[i + 1] = sstep(0.38, 0.5, t); break;   // 区間のまん中の 2 割ほどで切り替える。ほかは 1 枚の絵だけ
      }
      // 笑って細めた目（目コマ6。表情の eyeNarrow）: 目を開けているあいだだけ見せる。まばたきで閉じるときは、ふつうのコマへ戻る
      e.nw = e.hasNarrow ? clamp(ex.eyeNarrow || 0, 0, 1) * sstep(0.4, 0.6, o) : 0;
      if (e.nw > 0) { const r = 1 - sstep(0.5, 1, e.nw); for (let i = 0; i < W.length; i++) W[i] *= r; }
      e.ob = W[0]; e.cb = W[K.length - 1];
    } else e.ob = 1 - e.cb;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1;
      const C = lerp(e.Cc[i], e.Cs[i], smile);
      e.Ut[i] = C + (e.U[i] - C) * open;                       // 1 を超えると見開く
      const raised = e.L[i] - (smile * 0.05 + (e.lift || 0)) * H * (1 - u * u);  // 笑うと下まぶたが少し上がる
      e.Lt[i] = C + (raised - C) * o1;
    }
    // キーの形で動く目（model.json の keyEye）: まぶたの線を、キーから作る（上の式の線は使わない）
    if (e.ke) { e.ke.update(open, smile, F.eyeTilt || 0, F.eyeJito || 0, F.eyeShut || 0); e.ob = 1; e.cb = 0; }
    e.group.update();
  };
  // まぶたに合わせた上下のずれ。上まぶたより上は上まぶたと一緒に、下まぶたより下は下まぶたと一緒に動く
  e.lidDy = (x, y) => {
    const i = clamp(Math.round(x - e.xa), 0, n - 1);
    const Uy = e.U[i], Ly = e.L[i];
    const t = e.ke ? clamp((y - Uy) / Math.max(Ly - Uy, 1), 0, 1) : sstep(0, 1, (y - Uy) / Math.max(Ly - Uy, 24));
    return lerp(e.Ut[i] - Uy, e.Lt[i] - Ly, t);
  };
  return e;
}
const eyes = { R: makeEye(model.curves.eyeR), L: makeEye(model.curves.eyeL) };
const brows = { R: makeGroup(model.curves.browR[0], model.curves.browR[1], 0.94 * R0, 0.5, 0, { xz: EYE_XZ }), L: makeGroup(model.curves.browL[0], model.curves.browL[1], 0.94 * R0, 0.5, 0, { xz: EYE_XZ }) };

// ---- 髪の揺れ（ばね振り子） -------------------------------------------------
// phi が根元側の振れ角、phi2 が毛先の遅れ。k ばね、c 減衰、gain 頭の動きの効き、grav 傾けたとき垂れる量
// z は、その髪が頭の回る軸からどれだけ前（+）・後ろ（-）にあるか（顔の半幅 R0 を 1 として）。
// 振り向くと、前の髪と後ろの髪は逆向きに動くので、取り残される向きも逆になる（ねらい: 振り向いた反対側に、後ろ髪が広がって見える）。
// turn は、振り向きに対する効きの倍率（左右の上限が小さいので、実際の動きより強めに効かせる）、
// drag は、振り向いている間じゅう髪が後ろへ流れる量（速さに比例。止まると、毛先が遅れて戻る）
const SWAY = {
  bangs: { k: 210, c: 15, gain: 0.55, grav: 0.10, z: 1.0, turn: 0.8, drag: 0.3 },
  side: { k: 95, c: 9, gain: 0.9, grav: 0.30, z: 0.75, turn: 1.6, drag: 1.0 },
  back: { k: 60, c: 7, gain: 1.0, grav: 0.38, z: -0.8, turn: 1.6, drag: 1.0 },
  tail: { k: 48, c: 5.5, gain: 1.4, grav: 0.5, z: -0.9, turn: 1.6, drag: 1.2 },
  ahoge: { k: 150, c: 5, gain: 1.6, grav: 0.15, z: 0.5, turn: 1.2, drag: 0.6 },
  ribbon: { k: 130, c: 10, gain: 0.7, grav: 0.2, z: -0.6, turn: 1.2, drag: 0.6 },
};
// 房モデル専用のばね（ねらいは「バネのあるコシ・小気味よい揺れ戻り」: 高めの k + 減衰比 ζ ≈ 0.27 で 1.5〜2 回弾んでスッと収まる）
const CLUMP_SWAY = {
  bangs: { k: 260, c: 9.5, gain: 0.46, grav: 0.08, z: 0.90, turn: 0.75, drag: 0.22, seed: 1.1 },
  side:  { k: 135, c: 6.2, gain: 0.76, grav: 0.22, z: 0.70, turn: 1.25, drag: 0.65, seed: 2.7 },
  back:  { k: 95,  c: 5.2, gain: 0.85, grav: 0.28, z: -0.75, turn: 1.30, drag: 0.75, seed: 4.3 },
};
// w2 は毛先の速さ（毛先もばねにして、行きすぎてから戻る）。by・wy は上下のはずみ
for (const k in SWAY) Object.assign(SWAY[k], { phi: 0, w: 0, phi2: 0, w2: 0, by: 0, wy: 0, seed: Math.random() * 10, yv: 0, ys: 0 });
// 房（レイヤー）ごとのばね。種類ごとの値（SWAY）を元に、速さ・止まりやすさ・大きさを少しずつ変えた、別々のばねを持たせる
// （ねらい: 左右の髪は、同じ動きをしない。少しずつ違う時間で揺れて、ばらける）。
// 幅の広い後ろ髪は 1 枚の絵なので、左半分と右半分に別のばねを持たせ、まん中でなめらかにつなぐ（絵は崩れない）。
// ばらつきの大きさは tune.strand（0 で、全部が種類ごとの値と同じ = 前と同じ動き）
const SWAY_INST = [];
function swayInst(grp, clump = false) {
  const g = (clump && CLUMP_SWAY[grp]) || SWAY[grp], i = SWAY_INST.length;
  const s = { g, clump, phi: 0, w: 0, phi2: 0, w2: 0, by: 0, wy: 0, yv: 0, ys: 0,
    vk: Math.sin(i * 2.4 + 0.5), vc: Math.sin(i * 4.1 + 1.1), vg: Math.sin(i * 1.3 + 2.0), ds: i * 1.9 };
  SWAY_INST.push(s);
  return s;
}
const swayByLayer = {};
let lastYawS = null;
const YAW_TEST = q.has('yawTest');
const EXPR_TEST = q.get('exprTest');
const forcedSway = q.has('sway') ? +q.get('sway') : null;
// 確認用: sway= で止めるとき、毛束ごとの毛先の遅れを、束ごとに違う向きへ入れる量（束どうしが離れたとき、下から何が見えるかを確かめる）
const swaySpread = q.has('swaySpread') ? +q.get('swaySpread') : 0;
let headVX = 0, lastHeadX = null, headVY = 0, lastHeadY = null;
// ---- 瞳のぷるん ---------------------------------------------------------------
// まばたきで目が開ききった瞬間を合図に、瞳を「きゅっと縮む → 縦に大きくふくらむ → 縦と横で違う速さで揺れ戻る」と動かす。
// この時間曲線と定数、うるみのゆらめき、左右の目の少しのずれは、PuruPuru PNGTuber（Apache License 2.0。出典は THIRD_PARTY_NOTICES.md。
// https://github.com/rotejin/PuruPuruPNGTuber ）の app.js（computeBounceXY・updateHighlightPulse・tearLensWarpPoint）の考え方を、
// このエンジンの「独立した瞳のレイヤー」向けに書き直したもの。
const TAU = Math.PI * 2;
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function puruXY(dt, out) {
  out[0] = out[1] = 0;
  if (dt < 0 || dt > 0.95) return;
  const ANT = 0.04, SWELL = 0.082;                      // 縮む予備動作 40ms、ふくらむ 82ms
  if (dt < ANT) { out[0] = out[1] = -smoother(dt / ANT) * 0.16; return; }
  if (dt < ANT + SWELL) { const e = smoother((dt - ANT) / SWELL); out[0] = lerp(-0.16, 0.22, e); out[1] = lerp(-0.16, 0.42, e); return; }
  const bt = dt - (ANT + SWELL), decay = Math.exp(-bt * 4.2);
  out[0] = decay * (Math.cos(TAU * bt * 4.0) * 0.78 + Math.sin(TAU * bt * 6.9 + 0.25) * 0.22) * 0.21;
  out[1] = decay * (Math.cos(TAU * bt * 5.0 + 0.08) * 0.8 + Math.sin(TAU * bt * 8.3 + 0.65) * 0.2) * 0.39;
}
const forcedPuru = q.has('puruT') ? +q.get('puruT') : null;   // 確認用: ぷるんを、合図から決まった秒数の所で止める
let eyeRest = 1;       // 今の表情での「開いた目」の開き（細めた表情でも、開ききったことが分かるように）
const puruTmp = [0, 0];
// 位置のゆれは、視線が動いたとき・頭が動いたときに、ばねを弾く
function stepEyeJig(dt, dv, dvy, time) {
  const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps, amt = tune.sway * USER.sway / 1.5, ts = time / 1000;
  const follow = 1 - Math.exp(-dt * 38);
  for (const key of ['R', 'L']) {
    const e = eyes[key], j = e.jig, late = key === 'L';   // 画面右の目は 26ms 遅らせ、少し小さく揺らす（左右がそろいすぎないように）
    const op = Math.min(e.open, 1);
    if (op < 0.4 * eyeRest) j.armed = true;
    else if (j.armed && op >= 0.94 * eyeRest) { j.armed = false; j.t0 = ts + (late ? 0.026 : 0); }
    if (forcedPuru !== null) { puruXY(forcedPuru, puruTmp); j.px = puruTmp[0]; j.py = puruTmp[1]; j.sh = 0; }
    else {
      puruXY(ts - j.t0, puruTmp);
      j.px += (puruTmp[0] * (late ? 0.96 : 1) - j.px) * follow;
      j.py += (puruTmp[1] * (late ? 0.96 : 1) - j.py) * follow;
      const i = late ? 1 : 0;
      j.sh = idle ? Math.sin(TAU * (ts * 1.45 + i * 0.17)) * 0.006 + Math.sin(TAU * (ts * 2.35 + i * 0.31)) * 0.003 : 0;
    }
    if (forcedSway !== null) { j.jx = j.jy = 0; j.pgx = e.gx; j.pgy = e.gy; continue; }
    j.vx += (-(e.gx - j.pgx) * 20 * 9 - dv * 0.004) * amt;      // 視線・頭の動きに遅れてついていく
    j.vy += (-(e.gy - j.pgy) * 13 * 9 - dvy * 0.004) * amt;
    j.pgx = e.gx; j.pgy = e.gy;
    for (let i = 0; i < steps; i++) {
      j.vx += (-260 * j.jx - 13 * j.vx) * h; j.jx += j.vx * h;
      j.vy += (-260 * j.jy - 13 * j.vy) * h; j.jy += j.vy * h;
    }
    j.jx = clamp(j.jx, -9, 9); j.jy = clamp(j.jy, -7, 7);
  }
}
function stepSway(dt, time) {
  const hx = pose.sinY * 150 + pose.ox - pose.sr * 420;   // 頭の横位置の目安
  const vx = lastHeadX === null ? 0 : (hx - lastHeadX) / dt;
  lastHeadX = hx;
  const dv = vx - headVX;
  headVX = vx;
  const hy = pose.oy + pose.sinP * 260 + Math.abs(pose.sr) * 60;   // 頭の縦位置の目安
  const vy = lastHeadY === null ? 0 : (hy - lastHeadY) / dt;
  lastHeadY = hy;
  const dvy = vy - headVY;
  headVY = vy;
  stepEyeJig(dt, dv, dvy, time);
  const roll = Math.atan2(pose.sr, pose.cr);
  stepPhys(dt, dv, dvy, roll, time);
  const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
  // 振り向きの速さ（頭の回る軸から R0 だけ前にある点の、横の速さ px/秒）
  const yawS = pose.sinY * R0, yawV = lastYawS === null ? 0 : (yawS - lastYawS) / dt;
  lastYawS = yawS;
  const one1 = (s, g, K, C, G, seed) => {   // s: ばねの状態、g: 種類ごとの値、K・C・G: 速さ・止まりやすさ・大きさ
    if (forcedSway !== null) { s.phi = s.phi2 = forcedSway; s.by = q.has('swayBy') ? +q.get('swayBy') : 0; return; }
    // 振り向きのぶん: 前と同じ「頭の横位置の目安」に入っていた分（150px）を引いて、その髪の前後の位置に応じた分に置き換える
    const yv = yawV * (g.z * g.turn - 150 / R0) * tune.turn * USER.sway;
    const dyv = yv - s.yv; s.yv = yv;
    s.ys += (yv - s.ys) * (1 - Math.exp(-dt * 14));                 // ならした速さ（流れる量に使う）
    const flow = clamp(s.ys * 0.00022 * g.drag * tune.sway * USER.sway / 1.5, -0.16, 0.16);
    const rest = -roll * g.grav - flow + 0.006 * Math.sin(time * 0.0011 + seed) * (idle ? 1 : 0);
    s.w -= ((dv + dyv) * G * tune.sway * USER.sway) / 900;
    s.wy -= (dvy * G * tune.sway * USER.sway) / 1500;
    for (let i = 0; i < steps; i++) {
      s.w += (-K * (s.phi - rest) - C * s.w) * h;
      s.phi += s.w * h;
      if (s.clump) {
        s.w2 += (-K * 0.75 * (s.phi2 - s.phi * 1.35) - C * 0.55 * s.w2) * h;  // 房モデル: 張りのある追従と小気味よい揺れ戻り
      } else {
        s.w2 += (-K * 0.55 * (s.phi2 - s.phi * 1.7) - C * 0.45 * s.w2) * h;   // 毛先: 根元を追いかけ、行きすぎて戻る
      }
      s.phi2 += s.w2 * h;
      s.wy += (-K * 1.3 * s.by - C * 0.5 * s.wy) * h;                         // 上下のはずみ
      s.by += s.wy * h;
    }
    s.phi = clamp(s.phi, -0.4, 0.4);
    s.phi2 = clamp(s.phi2, -0.7, 0.7);
    s.by = clamp(s.by, -0.09, 0.09);
  };
  for (const key in SWAY) { const s = SWAY[key]; one1(s, s, s.k, s.c, s.gain, s.seed); }
  const sv = tune.strand;
  for (const s of SWAY_INST) {
    const g = s.g, v = s.field ? sv * 0.5 : sv;          // 毛束の「流れ」のばね（左・まん中・右）は、違いを小さくする
    // 毛束の流れは、止まりやすさを 0.78 倍にして、揺れ戻りを少し残す（ねらい: 顔の横の髪は、約 0.6 秒の周期で 1.5〜2 回揺れて止まる）
    one1(s, g, g.k * (1 + 0.16 * s.vk * v), g.c * (s.field ? 0.78 : 1) * (1 + 0.16 * s.vc * v), g.gain * (1 + 0.14 * s.vg * v), g.seed + s.ds * sv);
  }
  stepLockChildren(dt);
}

// ---- レイヤーごとの動かし方を決める ----------------------------------------
const NECK_COMPLETE = !!(model.neck && model.neck.complete);
const FACE = [1, 0, 0, 0], EYE_R = [0, 1, 0, 0], EYE_L = [0, 0, 1, 0], MOUTH = [0, 0, 0, 1], NONE = [0, 0, 0, 0];
const tmp = [0, 0];
const one = () => 1;
const hang = (y) => sstep(1050, 1600, y) * 0.8;   // 肩より下の髪は、頭より体について動く

// 髪。横・上下の向きは房の上から下まで同じだけ動かす。
// かしげだけは、肩より下の毛先が頭についていかずに垂れるよう、下へ行くほど回転を弱める
function hairPose(x, y, out) {
  const h = hang(y);
  const a = lerp(Math.atan2(pose.sr, pose.cr), body.roll, h), ca = Math.cos(a), sa = Math.sin(a);
  const rx = out[0] - PIV[0], ry = out[1] - PIV[1];
  bodyT(x, y, tmp);
  out[0] = PIV[0] + rx * ca - ry * sa + lerp(pose.ox, tmp[0] - x, h);
  out[1] = PIV[1] + rx * sa + ry * ca + lerp(pose.oy, tmp[1] - y, h);
}
function hairPart(L, grp, S, root, len, amp = 1) {   // amp: 揺れの大きさの倍率（帽子のふちなど、少しだけ揺らすもの）
  // bangs（前髪・髪の下地・帽子）は、重なって 1 つに見える物なので、同じばねを使う。ずれると、下地が前髪のふちからのぞく
  let s = !SWAY[grp] ? null : grp === 'bangs' ? (swayByLayer['#bangs'] || (swayByLayer['#bangs'] = swayInst(grp))) : swayInst(grp);
  if (s && L.w > 900 && (grp === 'back' || grp === 'tail')) {
    // 幅の広い後ろ髪: 左半分と右半分で別のばね。まん中の 600px でなめらかにつなぐ
    const a = s, b = swayInst(grp), m = { phi: 0, w: 0, phi2: 0, w2: 0, by: 0 };
    s = { at(x) { const t = sstep(HX - 300, HX + 300, x); for (const k in m) m[k] = lerp(a[k], b[k], t); return m; } };
  }
  if (s) swayByLayer[L.name] = s;
  // レイヤー（房）ごとに、遅れと振れ幅を少し変える。同じ種類の髪が一斉に同じ動きをしないようにする。
  // レイヤーの中では同じ値なので、絵は崩れない
  const cxL = (L.x + L.w / 2 - HX) / R0;
  const lagL = 0.035 * Math.sin(cxL * 2.3 + L.y * 0.004) + 0.02 * cxL;
  const ampL = 1 + 0.18 * Math.sin(cxL * 3.1 + 1.3);
  return {
    cell: 40,
    deform: (x, y, out) => {
      const t = clamp((y - root) / len, 0, 1);
      // 房ごとに動きをずらす（ねらい: さらさら + 弾力）。
      // 横位置 x で決まる「遅れ」と「振れ幅」を持たせ、隣り合う房が少しずつ違うタイミングで動くようにする。
      // 遅れは、ばねの速さ w を使って「少し前の振れ角」を近似する。毛先は行きすぎたぶんだけ余計にしなる
      let sx = x;
      const s0 = s; { const s = s0 && s0.at ? s0.at(x) : s0;
      if (s) {
        // 横位置ごとに遅れを変える方式は、1 枚の絵の中で房が押し合って崩れたのでやめた。
        // 房ごとに動かすには、房を別レイヤーに分ける必要がある
        const phiE = (s.phi - s.w * lagL) * ampL;
        const phi2E = (s.phi2 - s.w2 * lagL * 1.5) * ampL + (s.phi2 - 1.7 * s.phi) * 0.25 * t;
        sx = x + amp * len * (phiE * 0.7 * Math.pow(t, 1.6) + phi2E * 0.5 * t * t * t);
      }
      surfMap(S, sx, y, out);
      hairPose(sx, y, out);
      if (s) out[1] += amp * len * s.by * Math.pow(t, 1.3);   // 上下のはずみ（毛先ほど大きい）
      }
    },
  };
}
// ---- 毛束（model.json の hairLocks・hairField・hairBases）----------------------
// 髪を「毛束 1 つ = レイヤー 1 枚」に分けたモデル用。動きは 2 段になっている。
//  (1) 流れ: 髪の全体で、なめらかにつながった 1 つのしなり（場所の関数）。種類（前髪・横髪・後ろ髪）ごとに、左・まん中・右の 3 つのばねを持ち、
//      横位置でなめらかに混ぜる。となりの束は、ほとんど同じに動く（束どうしが逆に動いて、すき間が開くことがない）。
//      下地（毛束に分ける前の髪の絵の全体。hairBases）も、同じ流れで動かすので、束のすき間からは、いつも同じ髪の絵が見える。
//  (2) 毛先: 束ごとの小さなばね。流れの毛先を、束ごとに少し違う速さで追いかける。その差のぶんだけ、束の軸に直角な向きへ、毛先だけを余計にしならせる
//      （さらっとした、束ごとの遅れ。止まっているときは 0）。
// 束ごとに奥行きを変えること（視差）は、やめた。振り向いたとき、束どうしがずれて、すき間と切り口が見えた。
//   hairLocks[名前] = { g: 種類（'bangs'・'side'・'back'）, root・tip: 根元と毛先 }
//   hairField = { front: { top, bangsLen, sideLen, sideX0, sideX1 }, back: { top, len } }   流れの、根元の高さと長さ（モデルの座標）
//   hairBases[名前] = 'front' か 'back'
// tune.fluff（毛束のふわふわ）: 毛先の束ごとの遅れの大きさ、左右へ伝わる遅れ、上下に弾んだときの広がり、待機中のそよぎ
const LOCKS = model.hairLocks || {}, HFIELD = model.hairField || null, HBASES = model.hairBases || {};
const FIELD_S = {};
function fieldSprings(grp) {
  if (!FIELD_S[grp]) FIELD_S[grp] = [-1, 0, 1].map((u) => { const s = swayInst(grp); s.field = true; s.vk = 0.5 * u; s.vc = -0.4 * u; s.vg = 0.3 * u; s.ds = 0.6 * u; return s; });
  return FIELD_S[grp];
}
const mixA = { phi: 0, w: 0, phi2: 0, w2: 0, by: 0 }, mixB = { phi: 0, w: 0, phi2: 0, w2: 0, by: 0 };
function fieldAt(S3, u, o) {            // u: -1（画面左の端）… 0 … +1（右の端）
  const a = u < 0 ? S3[0] : S3[2], c = S3[1], t = sstep(0, 1, Math.abs(u));
  o.phi = lerp(c.phi, a.phi, t); o.w = lerp(c.w, a.w, t); o.phi2 = lerp(c.phi2, a.phi2, t); o.w2 = lerp(c.w2, a.w2, t); o.by = lerp(c.by, a.by, t);
  return o;
}
// その場所での流れ（前の髪は、前髪と横髪を、顔の中心からの距離でなめらかに混ぜる）。返り値は mixA、長さは fieldLen
let fieldLen = 0;
function fieldMix(part, x) {
  const F = HFIELD[part], u = clamp((x - HX) / (1.15 * R0), -1, 1);
  if (part === 'back') { fieldLen = F.len; return fieldAt(fieldSprings('back'), u, mixA); }
  // 前の髪は、前髪も横髪も、同じ 1 つの流れで動かす（長さは、横髪の毛先まで。前髪は、その途中までなので、小さく動く）。
  // 前髪と横髪で、ばねと長さを横位置で切り替えたら、境目で束が押し合って、振り向いたとき、顔の横の髪がぐしゃぐしゃになった
  fieldLen = F.sideLen;
  return fieldAt(fieldSprings('side'), u, mixA);
}
const fs = [0, 0, 0];
function fieldShift(part, x, y, o) {   // o[0]: しなったあとの x、o[1]: 流れの中での位置 t、o[2]: 上下のはずみ
  const m = fieldMix(part, x), len = fieldLen, F = HFIELD[part], u = clamp((x - HX) / (1.15 * R0), -1, 1), f = tune.fluff;
  const t = clamp((y - F.top) / len, 0, 1.25);
  const lag = 0.028 * u * (1 + 0.6 * f);                                                      // 揺れが、まん中から左右へ、少し遅れて伝わる
  const wind = forcedSway !== null ? 0 : f * (idle ? 1 : 0.35) * 0.014 * Math.sin(frameT * 0.00115 + u * 2.2);   // 待機中のそよぎ（髪を横切る、ゆっくりした波）
  const phiE = m.phi - m.w * lag + wind;
  const phi2E = m.phi2 - m.w2 * lag * 1.5 + wind * 1.6 + (m.phi2 - 1.7 * m.phi) * 0.25 * t;
  o[0] = x + len * (phiE * 0.7 * Math.pow(t, 1.6) + phi2E * 0.5 * t * t * t + m.by * u * 1.2 * f * Math.pow(t, 1.5));   // 最後の項: 上下に弾むと、外へ広がって戻る
  o[1] = t;
  o[2] = len * m.by * Math.pow(t, 1.3);
}
// 毛先のばね（束ごと）
const LOCK_CH = [];
function stepLockChildren(dt) {
  if (!LOCK_CH.length) return;
  const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
  for (const c of LOCK_CH) {
    if (forcedSway !== null) { c.d = clamp(forcedSway * swaySpread * 0.8 * c.vk, -0.15, 0.15); continue; }
    const m = fieldMix(c.part, c.x), g = SWAY[c.g], K = g.k * 0.55 * (1 + 0.35 * c.vk), C = g.c * 0.42 * (1 + 0.3 * c.vc), tgt = 1.7 * m.phi;
    for (let i = 0; i < steps; i++) { c.wp += (-K * (c.psi - tgt) - C * c.wp) * h; c.psi += c.wp * h; }
    c.psi = clamp(c.psi, -0.75, 0.75);
    c.d = clamp(c.psi - m.phi2, -0.15, 0.15);
  }
}
function lockPart(L, k) {
  const back = L.path === '後ろ髪', part = back ? 'back' : 'front', S = back ? SHELL.back2 : SHELL.bangs;
  const rx = k.root[0], ry = k.root[1], dx0 = k.tip[0] - rx, dy0 = k.tip[1] - ry, len = Math.max(40, Math.hypot(dx0, dy0)), ux = dx0 / len, uy = dy0 / len;
  const i = LOCK_CH.length;
  const c = { part, g: SWAY[k.g] ? k.g : 'bangs', x: (rx + k.tip[0]) / 2, psi: 0, wp: 0, d: 0, vk: Math.sin(i * 2.4 + 0.5), vc: Math.sin(i * 4.1 + 1.1) };
  LOCK_CH.push(c);
  return {
    cell: 28,
    deform: (x, y, out) => {
      fieldShift(part, x, y, fs);
      // 毛先の遅れ: 束の軸に直角な向きへ、毛先だけ（下へ垂れた束なら横へ、横へはねた束なら縦へ）
      const t = clamp(((x - rx) * ux + (y - ry) * uy) / len, 0, 1.2);
      // 大きさは控えめに（長い束でも、毛先で 30px ほど）。大きいと、束どうしと下地の線が交差して、ぐしゃぐしゃに見える
      const b = Math.min(len, 700) * c.d * 0.3 * tune.fluff * t * t * Math.sqrt(t);
      const sx = fs[0] + b * uy, sy = y - b * ux * 0.85, by = fs[2];
      surfMap(S, sx, sy, out);
      hairPose(sx, sy, out);
      out[1] += by;
    },
  };
}
// 下地（毛束に分ける前の髪の絵の全体）。流れだけで動かす
function basePart(L, part) {
  const S = part === 'back' ? SHELL.back2 : SHELL.bangs;
  return {
    cell: 32,
    deform: (x, y, out) => {
      fieldShift(part, x, y, fs);
      const sx = fs[0], by = fs[2];
      surfMap(S, sx, y, out);
      hairPose(sx, y, out);
      out[1] += by;
    },
  };
}
// ---- 房（model.json の hairClumps）----------------------------------------------
// 毛束を「房」（前髪 5・横髪 4・後ろ髪 8 くらい）にまとめたモデル用。Live2D の髪の作り方（房ごとのパーツ + 振り子）と同じ考え方。
//  - 房 1 つ = レイヤー 1 枚 = ばね 1 つ（根元の振れ角 phi と、毛先の遅れ phi2 の 2 段の振り子）。房の中の毛束どうしは、ずれない。
//  - 房は、根元から毛先への軸に沿って、「長さを変えずに」曲げる（軸の上の各点での向きを決め、それを根元から足し合わせて位置を出す）。
//    横へずらすだけの変形（前の版）は、大きく揺れると毛先が最大 1.7 倍に伸びて、ゴムのように見えた。
//  - 根元から t0 までは、頭に付いたまま動かさない（頭の丸みに乗っている部分）。そこから先が、しなる。
//  - 房どうしは、少しずつ違う速さ・大きさで揺れる（tune.strand）。房のすき間からは、下にある物（顔・後ろの房・後頭部）が見える。
//   hairClumps[名前] = { g: 種類（'bangs'・'side'・'back'）, root・tip: 根元と毛先（モデルの座標） }
// ?hairBend= で、曲がる大きさの倍率を試せる
const CLUMPS = model.hairClumps || null;
const HAIR_BEND = q.has('hairBend') ? +q.get('hairBend') : 1;
// model.json の hairWrap（0〜1。書かなければ 0 = 前と同じ。?hairWrap= で試せる）: 後ろの房を、形を保ったまま、頭のまわりを回る塊として動かす。
// 房ごとに、奥行きを 1 つ決める（房の左右のまん中が、頭の中心線から遠いほど浅い。まうしろで 0.5·R0、半幅 1.75·R0 の楕円）。
// 横を向くと、房の全体が、(まん中の横位置)·(cos − 1) + 奥行き·sin だけ、横へ動く（幅は変えない）:
//   奥の側の房は、顔の後ろへ大きく回り込み（見える所が小さくなる）、手前の側の房は、少し寄るだけで、幅を保つ。
// 前（殻に、点ごとに沿わせる）は、頭の横に大きく張り出した房で、手前の房が狭く・奥の房が広くなった（立体として逆）
const HAIR_WRAP = clamp(q.has('hairWrap') ? +q.get('hairWrap') : (typeof model.hairWrap === 'number' ? model.hairWrap : 0), 0, 1);
const CL_N = 24;
function clumpPose(x, y, out) {
  const h = sstep(1260, 1750, y) * 0.7;   // 肩より上の横髪は途中で折れず頭に自然についていく
  const a = lerp(Math.atan2(pose.sr, pose.cr), body.roll, h), ca = Math.cos(a), sa = Math.sin(a);
  const rx = out[0] - PIV[0], ry = out[1] - PIV[1];
  bodyT(x, y, tmp);
  out[0] = PIV[0] + rx * ca - ry * sa + lerp(pose.ox, tmp[0] - x, h);
  out[1] = PIV[1] + rx * sa + ry * ca + lerp(pose.oy, tmp[1] - y, h);
}
function clumpPart(L, k) {
  const back = k.g === 'back', S = back ? SHELL.clumpBack : SHELL.clumpFront;
  const rx = k.root[0], ry = k.root[1], dx0 = k.tip[0] - rx, dy0 = k.tip[1] - ry, len = Math.max(40, Math.hypot(dx0, dy0));
  const ux = dx0 / len, uy = dy0 / len, wx = uy, wy = -ux;          // u: 軸の向き、w: 軸に直角（垂れた房なら、画面の右）
  // shared: 下地（房のすき間から見える、内側の髪）。種類ごとのばね（房のばねの、まん中の値）で動かす
  const grp = SWAY[k.g] ? k.g : 'bangs';
  const s = k.shared ? SWAY[grp] : swayInst(grp, true);
  const u = clamp((k.tip[0] - HX) / (1.15 * R0), -1, 1), t0 = back ? 0.08 : 0.20, ph = SWAY_INST.length * 1.3;
  const span = len * 1.35, step = span / CL_N;
  // 振れ角の上限（ラジアン）。前髪はコンパクトに、横髪・後ろ髪も形を壊さない範囲でコシのある揺れに
  const AMAX = k.g === 'bangs' ? 0.26 : k.g === 'side' ? 0.42 : 0.46, IN_MAX = 0.09, sgIn = k.g === 'side' ? (u < 0 ? -1 : 1) : 0;
  const tab = new Float32Array((CL_N + 1) * 3);                     // 軸の上の点ごとの（軸方向の位置、直角方向の位置、向き）
  // hairWrap 用: 房の左右のまん中（頭の中心線から）と、その奥行き
  const wcx = L.x + L.w / 2 - HX, wz = -0.5 * R0 * Math.sqrt(Math.max(0, 1 - (wcx / (1.75 * R0)) ** 2));
  const wrap = back && !k.shared ? HAIR_WRAP : 0;
  let stamp = -1;
  const update = () => {
    stamp = frameT;
    const f = tune.fluff, sp = forcedSway !== null ? 1 + swaySpread * (s.vk || 0) : 1;
    const lag = 0.022 * u * (1 + 0.5 * f);                                                         // 揺れが、まん中から左右へ、少し遅れて伝わる
    const wind = forcedSway !== null ? 0 : f * (idle ? 1 : 0.35) * 0.009 * Math.sin(frameT * 0.00125 + u * 2.2 + ph);   // 待機中のそよぎ
    const phi = (s.phi - s.w * lag) * sp + wind, phi2 = (s.phi2 - s.w2 * lag * 1.4) * sp + wind * 1.5, by = s.by * u * 1.3;
    let X = 0, Y = 0, a0 = 0;
    tab[0] = 0; tab[1] = 0; tab[2] = 0;
    for (let i = 1; i <= CL_N; i++) {
      const tt = clamp((i * step / len - t0) / (1 - t0), 0, 1.3);
      // 向き: tt=0 で傾き 0 から滑らかに立ち上がる片持ち梁の曲線（途中でカクッと折れない）
      let a = HAIR_BEND * (phi * Math.pow(tt, 1.55) + phi2 * 0.72 * Math.pow(tt, 2.3) + by * tt * tt);
      a = AMAX * Math.tanh(a / AMAX);                                        // 振れ角の上限（なめらかに頭打ち）
      if (sgIn && a * sgIn < 0) a = -sgIn * IN_MAX * Math.tanh(-a * sgIn / IN_MAX);   // 顔の横の房は、顔の側へは少ししか入らない（顔に当たる）
      const am = (a + a0) / 2;
      X += Math.cos(am) * step; Y += Math.sin(am) * step; a0 = a;
      tab[i * 3] = X; tab[i * 3 + 1] = Y; tab[i * 3 + 2] = a;
    }
  };
  const part = {
    cell: 24,
    deform: (x, y, out) => {
      if (stamp !== frameT) update();
      const a = (x - rx) * ux + (y - ry) * uy, n = (x - rx) * wx + (y - ry) * wy;
      let sx = x, sy = y;
      if (a > 0) {
        const fi = Math.min(a / step, CL_N - 1e-3), i = Math.floor(fi), fr = fi - i, j = i * 3;
        const th = tab[j + 2] + (tab[j + 5] - tab[j + 2]) * fr, c = Math.cos(th), sn = Math.sin(th);
        const ex = a - Math.min(a, span);                                    // 表の先は、先の向きのまま、まっすぐ
        const X = tab[j] + (tab[j + 3] - tab[j]) * fr + ex * c - n * sn, Y = tab[j + 1] + (tab[j + 4] - tab[j + 1]) * fr + ex * sn + n * c;
        sx = rx + ux * X + wx * Y; sy = ry + uy * X + wy * Y;
      }
      surfMap(S, sx, sy, out);
      if (wrap > 0) {
        const z = wz * tune.depth;
        out[0] = lerp(out[0], sx + wcx * (pose.cosY - 1) + z * pose.sinY + tiltT * (sy - TILT_Y0), wrap);
        out[1] = lerp(out[1], pitchY(sy, z * pose.cosY), wrap);
      }
      clumpPose(sx, sy, out);
    },
  };
  CLUMP_DEF[L.name] = part.deform;   // 硬い小物（ヘアピンなど）が、留めている房と同じ動きを、付いている点で使う（makeFrame）
  return part;
}
const CLUMP_DEF = {};
const HAIR_SHELL = {
  '後頭部': SHELL.cap, '後ろ髪2': SHELL.back2, '後ろ髪1R': SHELL.back1, '後ろ髪1L': SHELL.back1,
  '横髪R': SHELL.side, '横髪L': SHELL.side, '下髪': SHELL.bun, 'お団子': SHELL.bun, 'アホ毛': SHELL.bun,
};
const HAT_SWAY = q.has('hatSway') ? +q.get('hatSway') : (model.hat && typeof model.hat.sway === 'number' ? model.hat.sway : 0.25);   // 帽子のふちの揺れ（前髪の揺れに対する倍率）
const bangsGroup = (name) => (/前髪[67]|エアインテーク/.test(name) ? 'side' : 'bangs');

// ---- 揺れ物（model.json の physics）------------------------------------------
// 髪のほかに揺らしたい物（帽子、髪飾りの鎖、胸のリボンなど）を、キャラごとの設定で指定する。エンジンはキャラを知らない。
//   id・label   操作パネル（「飾りごとに決める」「揺れ物」）と書き出しで使う名前。label は、使う人が読んで分かる言葉にする
//   layers      動かすレイヤーの名前（複数可。最初の 1 枚の箱を、支点と長さの基準にする）
//   attach      何に付いているか。'hat' 頭（帽子と同じ動き）/ 'pin' 頭（髪飾りと同じ。向きで曲げない）/ 'body' 体
//   type        'jelly'    ぷるんと弾む。支点より上は伸び縮みしながら遅れて揺れ、支点より下（ふち）はさらに遅れて波打つ
//               'cloth'    布のようにしなる（支点から先へ行くほど大きく、遅れて揺れる）
//               'pendulum' 長さを保って吊り下がる（絵を伸ばさず、弧を描いて曲がる。かしげると真下へ垂れる）
//               'sprout'   根元（支点）から上へ伸びる毛（アホ毛・立った毛束）。根元は動かさず、根元のまわりに、重さのある毛束として揺れる:
//                          根元で phi、根元から遠い所ほど phi2（少し遅れて、少し行きすぎる）だけ回す。輪・巻いた毛の形は、つぶさない。
//                          上下に動くと、少し縮んで太り、伸びて細る（squash）。frame（"follow": "auto"）と組にして、根元を、生えている所の房に乗せる
//   pivot       支点。基準の箱の中での割合 [x, y]（左上が 0,0）。len: 支点から先の長さ（箱の高さに対する割合。省略で箱の下端まで）
//   parent      別の揺れ物の id。その揺れ物の変形に乗る（傘のふちに付いた垂れ、など）
//   gain 大きさ / k 速さ（ばね）/ c 止まりやすさ（減衰）/ grav かしげたとき垂れる量 / tip 先の行きすぎ / squash 伸び縮み / pulse 待機中の脈動
//   expr        表情ごとの向き {"表情の名前": 角度（度。＋で、画面で時計回り）}（書かなければ前と同じ）。その表情の間、止まる向きを、この角度だけずらす
//               （ケモ耳: 困ると外へ寝かせ、驚くと立てる）。切り替わりは、ばねが運ぶので、ぴょこんと弾んで向きが変わる
//   twitch      ときどき、ぴくっと動く {"every": [最短, 最長]（秒）, "kick": 速さ（ラジアン毎秒。＋で時計回り）, "n": 回数（省略 1）, "gap": 間（秒。省略 0.13）}
//               （書かなければ前と同じ）。待機中（手で止めていないとき）だけ。速さを足すだけで、あとは、ばねが戻す
const PHYS_DEF = {
  jelly: { k: 120, c: 6, gain: 1, grav: 0, tip: 1.6, squash: 1, pulse: 0, max: 0.35 },
  cloth: { k: 110, c: 8, gain: 1, grav: 0.3, tip: 1.7, squash: 1, pulse: 0, max: 0.5 },
  pendulum: { k: 75, c: 3.2, gain: 1, grav: 1, tip: 1.3, squash: 0, pulse: 0, max: 1.0 },
  // 'rigid' 固い物（アンテナなど）。曲げず、支点のまわりに回るだけ（はずみ）。max は回る角度の上限（ラジアン）
  rigid: { k: 160, c: 9, gain: 0.5, grav: 0, tip: 1, squash: 0, pulse: 0, max: 0.08 },
  // 'sprout' 根元から上へ伸びる毛。ねらいは「重さとこしのある毛束」: 1 秒に約 1.5 往復の速さで、1 回だけ行きすぎて、0.7〜0.9 秒で止まる
  // （止まりやすさの比 ζ = c / (2√k) ≈ 0.35）。grav は小さく（かしげても、少し倒れるだけ）。
  // 前の値（k 150・c 5・先の行きすぎ 1.6、先のばねは布と同じ式）は、先だけが最大 ±29°で、1 秒たっても ±14°で揺れ続け（根元は ±7〜12°）、薄い紙がぺらぺら動くように見えた
  sprout: { k: 90, c: 6.6, gain: 1.3, grav: 0.15, tip: 1.25, squash: 2.5, pulse: 0, max: 0.32 },
};
// 揺れ物の付き方を「固い板」にする（spec.frame。書かなければ前と同じ attach の動き）: 付いている点（frame.anchor。省略で支点）の動きだけを、
// 揺れ物の全体に一次の変換として掛ける（makeFrame）。点ごとに頭の面へ沿わせないので、硬い物（ヘッドホン・アンテナ・ピアス）の形が曲がらない。
// 振り子の spec.stiff: true は、弧に曲げず、まっすぐのまま振れる（鎖・ピアス）
const PHYS_SLIDERS = [
  { key: 'gain', label: '大きさ', min: 0, max: 3 },
  { key: 'k', label: '速さ', min: 15, max: 300 },
  { key: 'c', label: '止まりやすさ', min: 0.5, max: 25 },
];
const PHYS = [], PHYS_BY_ID = {}, PHYS_BY_LAYER = {};
for (const spec of model.physics || []) {
  const base = byName[(spec.layers || [])[0]];
  if (!base || !PHYS_DEF[spec.type]) continue;
  const s = Object.assign({}, PHYS_DEF[spec.type], spec, { phi: 0, w: 0, phi2: 0, w2: 0, by: 0, wy: 0, seed: PHYS.length * 1.7, ug: 1 });   // ug: 使う人の好みの倍率（「好みに合わせる」の、飾りごとの揺れ）
  const pv = spec.pivot || [0.5, 0];
  s.px = base.x + pv[0] * base.w; s.py = base.y + pv[1] * base.h;
  s.len = Math.max(8, (typeof spec.len === 'number' ? spec.len : 1 - pv[1]) * base.h);   // 支点から先（下）の長さ
  s.up = Math.max(8, s.py - base.y);                                                    // 支点から上の高さ（jelly）
  s.hw = Math.max(8, base.w / 2);
  s.rad = Math.max(s.up, 0.9 * Math.max(s.px - base.x, base.x + base.w - s.px));           // 支点から、いちばん遠い所までの目安（sprout）
  s.def = {}; for (const sl of PHYS_SLIDERS) s.def[sl.key] = s[sl.key];
  PHYS.push(s); PHYS_BY_ID[s.id] = s;
  for (const n of spec.layers) PHYS_BY_LAYER[n] = s;
}
const forcedPhys = q.has('physPhi') ? +q.get('physPhi') : null, forcedPhysBy = q.has('physBy') ? +q.get('physBy') : 0;   // 確認用: 揺れを決まった量で止める
let physPulse = 0;
// 揺れ物の変形（モデルの座標の中で動かす。このあと attach の動きを掛ける）
function physShift(s, x, y, out) {
  if (s.type === 'rigid') {   // 固い物: 支点のまわりに回るだけ（曲げない・伸ばさない）
    const c = Math.cos(s.phi), sn = Math.sin(s.phi), dx = x - s.px, dy = y - s.py;
    out[0] = s.px + dx * c - dy * sn; out[1] = s.py + dx * sn + dy * c;
    return;
  }
  if (s.type === 'pendulum') {
    const d = y - s.py, l = x - s.px;
    if (d <= 0) { out[0] = x; out[1] = y; return; }
    // 支点での角度 phi、先での角度 phi2。その間は一定の割合で曲がる（弧）。長さは変えない
    const dd = Math.min(d, s.len), kap = (s.phi2 - s.phi) / s.len, a = s.phi + kap * dd;
    let X, Y;
    if (Math.abs(kap * dd) < 1e-4) { X = dd * Math.sin(s.phi); Y = dd * Math.cos(s.phi); }
    else { X = (Math.cos(s.phi) - Math.cos(a)) / kap; Y = (Math.sin(a) - Math.sin(s.phi)) / kap; }
    const ex = d - dd, ca = Math.cos(a), sa = Math.sin(a);                     // 長さより先は、先の向きのまままっすぐ
    out[0] = s.px + X + ex * sa + l * ca; out[1] = s.py + Y + ex * ca - l * sa;
    return;
  }
  if (s.type === 'sprout') {
    // 根元（支点）のまわりに回す。回す角度は、根元で phi、根元から遠い所ほど phi2 へ近づく（根元からの距離で決める。距離は変えない）。
    // 高さ（行）ごとに角度を変えて曲げる式だと、輪になった毛・巻いた毛は、同じ輪の上と下で角度が違い、輪が斜めにつぶれた
    // （毛の道すじは、輪をひと回りしているので、高さは「根元からの遠さ」にならない）。距離で決めれば、輪はほぼ同じ角度で回り、形を保つ。
    // by（上下のはずみ）: 伸びたぶん細く、縮んだぶん太くする（厚みのある物に見せる）
    const dx = x - s.px, dy = y - s.py, q = 0.07 * Math.tanh(s.by * s.squash / 0.07);   // 伸び縮みは、7% で頭打ち（ゴムのように伸ばさない）
    const a = s.phi + (s.phi2 - s.phi) * Math.min(Math.hypot(dx, dy) / s.rad, 1), ca = Math.cos(a), sa = Math.sin(a);
    const X = dx * (1 - 0.5 * q), Y = dy * (1 + q);
    out[0] = s.px + X * ca - Y * sa; out[1] = s.py + X * sa + Y * ca;
    return;
  }
  if (s.type === 'cloth') {
    const t = clamp((y - s.py) / s.len, 0, 1);
    out[0] = x + s.len * (s.phi * 0.7 * Math.pow(t, 1.6) + s.phi2 * 0.5 * t * t * t);
    out[1] = y + s.len * s.by * s.squash * Math.pow(t, 1.3);
    return;
  }
  // jelly（支点の上下で幅・傾きが連続になるようにし、傘のドームやふちが折れずにぷるんと柔らかく弾む）
  const sq = s.by * s.squash - 0.010 * s.pulse * physPulse, u = (x - s.px) / s.hw;
  const baseScale = 1 - 0.20 * sq + 0.012 * s.pulse * physPulse;
  if (y <= s.py) {
    const t = Math.min((s.py - y) / s.up, 1.2);
    out[0] = s.px + (x - s.px) * (baseScale - 0.25 * sq * t - 0.012 * s.pulse * physPulse * t)
      + s.up * (s.phi * 0.35 * Math.pow(t, 1.6) + (s.phi2 - s.phi * s.tip) * 0.10 * Math.sin(Math.PI * Math.min(t, 1)));
    out[1] = s.py - (s.py - y) * (1 + sq * 0.85);
  } else {
    const r = Math.min((y - s.py) / s.len, 1), r2 = r * r;
    out[0] = s.px + (x - s.px) * baseScale + s.len * (s.phi2 * 0.65 * r2) + s.hw * u * (0.04 * r2) * s.pulse * physPulse;
    out[1] = y + s.len * (s.by * s.squash * 1.1 + 0.018 * s.pulse * physPulse) * r2 * (0.6 + 0.4 * u * u);
  }
}
const tmpP = [0, 0];
function physPart(L, s) {
  const chain = [s];
  for (let p = PHYS_BY_ID[s.parent]; p && chain.length < 4; p = PHYS_BY_ID[p.parent]) chain.push(p);
  const att = s.attach || 'hat';
  // 固い板（spec.frame）: いちばん根元の揺れ物（親をたどった先）の frame を使う。鎖は、アンテナの板に乗る
  let fo = null;
  for (const c of chain) if (c.frame) fo = c;
  // frame.pin: 髪飾りの板（model.json の rigidPins。花など、揺れ物でないレイヤー）に乗る。その飾りと、同じ板を使う
  const fr = fo ? (fo.frameObj || (fo.frameObj = (fo.frame.pin && pinFrame(fo.frame.pin)) || makeFrame(fo.frame, fo.px, fo.py, fo.type === 'sprout'))) : null;
  // hang: true（書かなければ前と同じ）: 板には、支点だけで乗る。形には、板の伸び縮みを写さず、頭のかしげだけを写す（飾りから下がっている鎖・しずく。
  // 飾りは、髪の面に寝ているので、奥へ向くと幅が縮むが、そこから下がっている真珠は、丸いまま）
  const hang = !!(s.hang && fr);
  return {
    cell: s.cell || (s.type === 'pendulum' || s.type === 'sprout' ? 14 : s.type === 'cloth' ? 24 : 40), phys: s,
    deform: (x, y, out) => {
      if (hang) {
        physShift(s, x, y, tmpP);
        const lx = tmpP[0] - s.px, ly = tmpP[1] - s.py;
        let qx = s.px, qy = s.py;
        for (let i = 1; i < chain.length; i++) { physShift(chain[i], qx, qy, tmpP); qx = tmpP[0]; qy = tmpP[1]; }
        fr.apply(qx, qy, out);
        const a = Math.atan2(pose.sr, pose.cr), ca = Math.cos(a), sa = Math.sin(a);
        out[0] += lx * ca - ly * sa; out[1] += lx * sa + ly * ca;
        return;
      }
      tmpP[0] = x; tmpP[1] = y;
      for (const c of chain) physShift(c, tmpP[0], tmpP[1], tmpP);
      const sx = tmpP[0], sy = tmpP[1];
      if (fr) fr.apply(sx, sy, out);
      else if (att === 'body') bodyT(sx, sy, out);
      else if (att === 'skin') { surfMap(SKIN, sx, sy, out); headPose(out); }   // 頭の面に沿う（耳と同じ。頭の横の結び目など。頭の端の外の物は、端と一緒に動く）
      else if (att === 'pin') pin.apply(sx, sy, out);
      else { surfMap(SHELL.hat, sx, sy, out); hairPose(sx, sy, out); }
    },
  };
}
let bodyVX = 0, lastBodyX = null, bodyVY = 0, lastBodyY = null;
function stepPhys(dt, dv, dvy, roll, time) {
  if (!PHYS.length) return;
  const bx = body.sway, bvx = lastBodyX === null ? 0 : (bx - lastBodyX) / dt;
  lastBodyX = bx;
  const dvB = bvx - bodyVX; bodyVX = bvx;
  const byy = -body.breath * 7, bvy = lastBodyY === null ? 0 : (byy - lastBodyY) / dt;
  lastBodyY = byy;
  const dvyB = bvy - bodyVY; bodyVY = bvy;
  physPulse = idle ? Math.sin(time * 0.0023) : 0;
  const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
  for (const s of PHYS) {
    if (forcedPhys !== null || forcedSway !== null) { s.phi = s.phi2 = forcedPhys !== null ? forcedPhys : forcedSway; s.by = forcedPhysBy; continue; }
    const onBody = s.attach === 'body';
    const a = onBody ? dvB : dv, ay = onBody ? dvyB : dvy;
    // 振り子は、頭（体）の傾きと同じ向きに振ると真下へ垂れる（headPose・bodyT は、roll が正で時計回り）。
    // 前は、振り子も布と同じ −roll で、傾きの 2 倍、横へ倒れていた（鎖・ピアスなど）。布の向きは、目で合わせてあるので変えない
    // 上へ伸びる毛（sprout）も、振り子と同じ向き（傾けた側へ、先が少し倒れる）
    const ex = s.expr ? (s.expr[exprName] || 0) * DEG : 0;   // 表情ごとの向き（spec.expr）
    const rest = -(onBody ? body.roll : roll) * s.grav * (s.type === 'pendulum' || s.type === 'sprout' ? -1 : 1) + 0.004 * Math.sin(time * 0.0013 + s.seed) * (idle ? 1 : 0) + ex;
    const sg = s.gain * USER.sway * s.ug;   // 大きさ = キャラの初期値 × 使う人の好み（全体 × 飾りごと）
    s.w -= (a * sg) / 550;
    if (s.twitch && idle) {   // ときどきの「ぴくっ」（spec.twitch）。間は、揺れ物ごとに決まった並び（撮り直しても同じ）
      const tw = s.twitch, ev = tw.every || [4, 9], rnd = (i) => { const v = Math.sin((s.seed + 1) * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
      if (s.twT === undefined) { s.twI = 0; s.twL = 0; s.twT = ev[0] + (ev[1] - ev[0]) * rnd(0); }
      s.twT -= dt;
      if (s.twT <= 0) {
        s.w += tw.kick; s.w2 += tw.kick * 1.3;
        if (++s.twL < (tw.n || 1)) s.twT = tw.gap || 0.13;
        else { s.twL = 0; s.twT = ev[0] + (ev[1] - ev[0]) * rnd(++s.twI); }
      }
    }
    s.wy -= (ay * sg) / 1100 + (Math.abs(a) * sg) / 9000;      // 横に動いたときも、少し縦に弾む
    const sprout = s.type === 'sprout';
    for (let i = 0; i < steps; i++) {
      s.w += (-s.k * (s.phi - rest) - s.c * s.w) * h;
      s.phi += s.w * h;
      if (sprout) {
        // 上へ伸びる毛: 先は、根元のすぐあとを追い、行きすぎは小さく、根元と同じくらい早く止まる（ばねを固く、止まりやすく）。
        // 上下のはずみも、1 回で止める。布と同じ式（下）では、先と、上下のはずみだけが、長く揺れ続けた
        s.w2 += (-s.k * 1.8 * (s.phi2 - (rest + (s.phi - rest) * s.tip)) - s.c * 1.3 * s.w2) * h;
        s.phi2 += s.w2 * h;
        s.wy += (-s.k * 1.3 * s.by - s.c * 1.2 * s.wy) * h;
      } else {
        s.w2 += (-s.k * 0.55 * (s.phi2 - (rest + (s.phi - rest) * s.tip)) - s.c * 0.45 * s.w2) * h;
        s.phi2 += s.w2 * h;
        s.wy += (-s.k * 1.3 * s.by - s.c * 0.5 * s.wy) * h;
      }
      s.by += s.wy * h;
    }
    s.phi = clamp(s.phi, ex - s.max, ex + s.max);
    s.phi2 = clamp(s.phi2, ex - s.max * 1.6, ex + s.max * 1.6);
    s.by = clamp(s.by, -0.09, 0.09);
    if (s.stiff) { s.phi2 = s.phi; s.w2 = s.w; }   // まっすぐのまま振れる（先の遅れを持たない）
  }
}

function eyePart(L, key) {
  const e = eyes[key], sel = key === 'R' ? EYE_R : EYE_L, n = L.name;
  const isIris = /瞳ベース|瞳孔|^ハイライト|ハート|しいたけ|ぐるぐる|闇/.test(n);
  const p = { cell: 12, sel1: FACE, sel2: NONE };
  if (isIris) {
    p.sel2 = sel;
    const hl = /^ハイライト/.test(n) ? 0.8 : 1;   // ハイライトは少しだけ遅れて動く（瞳に奥行きが出る）
    // 瞳の中心まわりに伸び縮みさせる。全体を少し（ふちごと）、まん中ほど大きく（レンズ。ふちは動かさず、中の模様と光だけがふくらむ）
    p.cell = 8;
    const isHl = /^ハイライト/.test(n);
    p.deform = (x, y, out) => {
      const j = e.jig, k = isHl ? 1.4 : 1;   // ハイライトは少し大きくゆれる
      const dx = x - e.cx, dy = y - e.cy;
      const r2 = (dx * dx) / (e.lrx * e.lrx) + (dy * dy) / (e.lry * e.lry);
      const m = r2 < 1 ? Math.pow(1 - r2, 2.2) : 0;
      const P = eyeTune.puru * USER.puru, Lm = eyeTune.lens * USER.puru * m * 4;
      const sx = 1 + P * j.px * (0.15 + Lm * 0.32) + eyeTune.shimmer * USER.puru * 4 * m * j.sh;
      const sy = 1 + P * j.py * (0.15 + Lm * 0.28) - eyeTune.shimmer * USER.puru * 4 * m * j.sh * 0.45;
      const ik = 1 + 0.2 * (F.irisSize || 0);   // 表情の「瞳の大きさ」（見開きで小さく）
      const px = e.cx + dx * sx * ik + j.jx * k, py = e.cy + dy * sy * ik + j.jy * k;
      e.group.apply(px + e.gx * 20 * hl, py + e.gy * 13 * hl + (1 - Math.min(e.open, 1)) * 10, out);
    };
    if (n.startsWith('瞳孔')) p.alpha = () => 1 - Math.max(diffW['ハート'] || 0, diffW['しいたけ'] || 0, diffW['ぐるぐる'] || 0);
  } else if (n.startsWith('目コマ')) {
    // 差分シートの途中のコマ（白目・瞳ごと描いてある絵）。位置は動かさない。顔の輪郭の内側だけに描く
    const k = +n.charAt(3) - 1;
    p.deform = (x, y, out) => e.group.apply(x, y, out);
    p.alpha = k === 5 ? () => e.nw : () => e.fw[k] || 0;   // 目コマ6 は、笑って細めた目
  } else if (/^(閉じ目|笑い目)/.test(n)) {
    p.lashFree = true;
    // 清書した閉じ目。位置は動かさない（閉じる途中のわずかな間だけ、上から下りてくる）
    const sm = n.startsWith('笑い目');
    p.deform = (x, y, out) => e.group.apply(e.lashX(x), y - Math.min(e.open, 0.3) * e.H * 0.5, out);
    p.alpha = () => e.cb * (e.hasSmile ? (sm ? e.smile : 1 - e.smile) : 1);
  } else {
    if (/^(アイライン線|アイラインハイライト|まつげ|二重)/.test(n)) {
      if (!n.startsWith('二重')) p.lashFree = true;
      const follow = n.startsWith('二重') ? 0.62 : 1;
      p.deform = (x, y, out) => e.group.apply(e.lashX(x), y + e.lineDy(x) * follow, out);
    } else p.deform = (x, y, out) => e.group.apply(x, y + e.lidDy(x, y), out);
    if (n.startsWith('白目影')) p.sel2 = sel;
    if (n.startsWith('アイラインハイライト')) p.alpha = () => sstep(0.55, 0.9, e.open);
    if (/下まつげ|くま/.test(n)) p.alpha = () => sstep(0.3, 1, e.lowOpen) * (1 - e.smile * 0.6);
    // 奥を向いた側の目は幅が詰まるので、閉じたときは目尻のはね（外側のまつげ）を薄くする。重なって黒い塊に見えるのを防ぐ
    if (/^まつげ2|^アイライン下/.test(n)) {
      const side = key === 'R' ? -1 : 1;
      p.alpha = () => 1 - sstep(0.25, 0.5, pose.sinY * side) * sstep(0.3, 0.8, e.close);
    }
    if (n.startsWith('白目')) { const a0 = p.alpha || one; p.alpha = () => a0() * (e.ke ? sstep(0.05, 0.16, e.ke.apert) : sstep(0.01, 0.08, e.open)); }
    if (e.hasClosed) { const a1 = p.alpha || one; p.alpha = () => a1() * e.ob; }   // 清書した閉じ目（と、途中のコマ）と入れ替わる
  }
  return p;
}
const BROW_AMP = typeof model.browAmp === 'number' ? model.browAmp : 16;
function browPart(L, key) {
  const g = brows[key], side = key === 'R' ? 1 : -1;
  return {
    cell: 14,
    deform: (x, y, out) => {
      const a = F.browAngle * side * 0.3, lx = x - g.ax, ly = y - g.ay;
      const ca = Math.cos(a), sa = Math.sin(a);
      const bend = F.browForm ? -F.browForm * 11 * (1 - Math.min(1, (lx / (0.5 * L.w)) ** 2)) : 0;   // まん中が上がる（+）・下がる（−）
      g.apply(g.ax + lx * ca - ly * sa, g.ay + lx * sa + ly * ca - F.browY * BROW_AMP + bend, out);
    },
  };
}
// 肌に貼りついているもの（頬の赤み・影など）。輪郭そのもの（輪郭ベース・輪郭線）は SKIN、塗りは SHADE を使う
const SHADE = Object.assign({}, SKIN, { Z0P: (y) => 0.85 * SKIN.Zc(y), Z0D: null });
function skinPart(sel) {
  const S = sel === FACE ? SHADE : SKIN;
  return { cell: 28, sel1: sel || NONE, deform: (x, y, out) => { surfMap(S, x, y, out); headPose(out); } };
}
function groupPart(g, cell) {
  return { cell, group: g, deform: (x, y, out) => g.apply(x, y, out) };
}
// 鼻: 基準は鼻の絵の左右のまん中（鼻すじ）。横を向くと、向いた側の半分（鼻の向こう側の面）が詰まり、手前の面が広がる
const noseL = LAYERS.find((L) => L.path === '頭/顔/鼻');
// model.noseAxis: 鼻すじの x。数 1 つか、[左を向くとき, 右を向くとき]。書かなければ、顔のまん中の線を鼻の絵の中へ寄せた所
// （鼻の絵が、まん中の線より右にあると、絵の左の端になる。そういう絵で右を向くと、鼻の全部が「向いた側の半分」として詰まり、線になって消えた）
const NA_ = model.noseAxis, noseAx0 = noseL ? clamp(HX, noseL.x, noseL.x + noseL.w) : HX;
const nose = makeGroup(1500, 940, 1.25 * R0, 0, 0, { lead: 0.1, asym: 1.85, aw: 8, fit: [FIT_Z, FIT_Z],
  px: Array.isArray(NA_) ? NA_[0] : typeof NA_ === 'number' ? NA_ : noseAx0, pxR: Array.isArray(NA_) ? NA_[1] : undefined });
const cheeks = [makeGroup(1325, 952, SKIN, 0.4), makeGroup(1675, 952, SKIN, 0.4)];
const pin = makeGroup(1840, 535, SHELL.bangs, 0.5);
const tmp2 = [0, 0];
function bodyPart(L) {
  const n = L.name;
  if (/^リボン[12]/.test(n) || n === 'リボン1 影R' || n === 'リボン1 影L') {
    const s = SWAY.ribbon, root = 1500, len = 260, isTail = /リボン2/.test(n);
    return { cell: 40, deform: (x, y, out) => {
      const t = clamp((y - root) / len, 0, 1);
      bodyT(x + (isTail ? len * s.phi * 0.5 * t * t : 0), y, out);
    } };
  }
  return { cell: 60, deform: bodyT };
}

// 耳（ピアスの板も、付け根で同じ動きを使う）
function earDeform(x, y, out) {
  const sgn = x < HX ? -1 : 1, Rf = SKIN.R(y) + EDGE_BAND, xe = HX + sgn * Rf;
  surfMap(SKIN, xe, y, tmp2);                       // その高さでの顔の端の行き先
  const tl = tiltT * (y - TILT_Y0);                 // 斜めのときの傾きのぶんは、耳の全体に、そのまま足す（先だけ残さない）
  const D = tmp2[0] - xe - tl, as = Math.abs(pose.sinY);
  if (sgn * pose.sinY > 0) out[0] = x + D - sgn * 150 * clamp(as / 0.42, 0, 1) + tl;            // 奥側: 顔の裏へ
  else out[0] = x + D * lerp(1, 0.25, clamp((Math.abs(x - HX) - Rf) / 80, 0, 1)) + tl;         // 手前側: 付け根はついていき、先は残る
  out[1] = pitchY(y, -0.79 * R0 * pose.cosY);      // 耳は軸より後ろ。上を向くと下がり、下を向いても動かない
  headPose(out);
}
// ---- 硬い小物（ヘアピン・ヘッドホン・アンテナ・ピアスなど）: 1 枚の「固い板」として動かす --------------------
// 付いている点（anchor）で、下にある物（留めている髪の房・頭の髪の面・耳・頭の横）と同じ計算をして、その点の位置と、
// まわりの小さな動き（回り・縮み。12 画素ずらした 2 点の行き先から取る）を出し、小物の全体には、その一次の変換だけを掛ける。
// 点ごとに面へ沿わせないので、形は曲がらない（直線は直線のまま）。前は、ヘアピンの全部を、別の場所（kurage02 の髪飾りの位置）の
// 1 つの基準点で動かしていて、左右のピンが髪とずれた。ヘッドホンは顔の面に点ごとに沿わせていて、形がゆがんだ
//   spec = { anchor: [x, y]（モデルの座標）, follow: 房の名前（その房が揺れると、一緒に動く。組み立ての道具が、付いている点を覆う房を選ぶ）,
//            surf: 'hair'（頭の髪の面。既定）| 'skin'（顔の面）| 'ear'（耳）| 'side'（頭の横から外へ出た物）, z, zx（'side' だけ） }
//   'side': 奥行き z（顔の半幅の割合）の点として回し、横を向くと、向いた側へは細く、反対側へは広く見せる（zx。makeGroup と同じ）
//   stand: true（上へ伸びる毛 sprout は、書かなければ true。ほかは false = 前と同じ）: 面から立っている物。位置は、付いている点と同じに動かし、
//          向きは、頭のかしげだけを写す（面の縮みは写さない）。面に寝ている物（ヘアピン）は、面と一緒に縮むが、面から立つ毛は、縮まない。
//          写すと、右を向いたときだけ幅が 1 割 狭くなり（左では狭くならない）、下を向くと高さが 6% 縮んだ
const FRAME_H = 12;
function makeFrame(spec, ax0, ay0, standDef = false) {
  const ax = spec.anchor ? spec.anchor[0] : ax0, ay = spec.anchor ? spec.anchor[1] : ay0;
  const stand = typeof spec.stand === 'boolean' ? spec.stand : standDef;
  const f = { ax, ay, stamp: -1, p: [0, 0], J: [1, 0, 0, 1] }, o0 = [0, 0], o1 = [0, 0], o2 = [0, 0];
  let F = null, g = null;
  const resolve = () => {
    if (spec.follow && CLUMP_DEF[spec.follow]) F = CLUMP_DEF[spec.follow];
    else if (spec.surf === 'skin') F = (x, y, o) => { surfMap(SKIN, x, y, o); headPose(o); };
    else if (spec.surf === 'ear') F = earDeform;
    else if (spec.surf === 'side') { g = makeGroup(ax, ay, (typeof spec.z === 'number' ? spec.z : 0.3) * R0, typeof spec.zx === 'number' ? spec.zx : 1, 0); F = (x, y, o) => g.apply(x, y, o); }
    else if (CLUMPS) F = (x, y, o) => { surfMap(SHELL.clumpFront, x, y, o); clumpPose(x, y, o); };
    else F = (x, y, o) => { surfMap(SHELL.bangs, x, y, o); hairPose(x, y, o); };
  };
  f.update = () => {
    if (f.stamp === frameT) return;
    f.stamp = frameT;
    if (!F) resolve();
    if (g) g.update();
    if (stand) {
      F(ax, ay, o0);
      f.p[0] = o0[0]; f.p[1] = o0[1];
      const a = Math.atan2(pose.sr, pose.cr), ca = Math.cos(a), sa = Math.sin(a);
      f.J[0] = ca; f.J[1] = -sa; f.J[2] = sa; f.J[3] = ca;
      return;
    }
    F(ax, ay, o0); F(ax + FRAME_H, ay, o1); F(ax, ay + FRAME_H, o2);
    f.p[0] = o0[0]; f.p[1] = o0[1];
    f.J[0] = (o1[0] - o0[0]) / FRAME_H; f.J[1] = (o2[0] - o0[0]) / FRAME_H;
    f.J[2] = (o1[1] - o0[1]) / FRAME_H; f.J[3] = (o2[1] - o0[1]) / FRAME_H;
  };
  f.apply = (x, y, out) => {
    f.update();
    const lx = x - ax, ly = y - ay;
    out[0] = f.p[0] + f.J[0] * lx + f.J[1] * ly; out[1] = f.p[1] + f.J[2] * lx + f.J[3] * ly;
  };
  return f;
}

// 髪飾りの板（model.json の rigidPins[レイヤーの名前]）。同じ飾りに付いた揺れ物（リボン・鎖）は、spec.frame.pin で、この板に乗る
// （花と、リボン・鎖が、別々の基準点で動くと、留めている髪が揺れたとき・横を向いたとき、つなぎ目がずれる）
const PIN_FRAMES = {};
function pinFrame(n) {
  const sp = model.rigidPins && model.rigidPins[n], L = byName[n];
  if (!sp || !L) return null;
  return PIN_FRAMES[n] || (PIN_FRAMES[n] = makeFrame(sp, L.x + L.w / 2, L.y + L.h / 2));
}

// 目と同じ動きにするレイヤー（目のすぐ下の、涙・汗の粒や、ほほの斜線）。目は、顔の中で、肌の面とは別に動く
// （下を向くと下へ滑る・横を向くと、あご先に合わせて余分に動く）。1 枚に左右の目のぶんが入っているので、顔のまん中で、左右の目の動きを切り替える
function eyeFollowPart(sel) {
  const gR = eyes.R.group, gL = eyes.L.group, oa = [0, 0], ob = [0, 0];
  return { cell: 20, sel1: sel, deform: (x, y, out) => {
    const w = sstep(HX - 50, HX + 50, x);
    gR.apply(x, y, oa); gL.apply(x, y, ob);
    out[0] = lerp(oa[0], ob[0], w); out[1] = lerp(oa[1], ob[1], w);
  } };
}
function classify(L) {
  const n = L.name, path = L.path;
  if (EXT && EXT.part) { const p = EXT.part(L, { bodyT, model }); if (p) return p; }   // BOXP-716: 脚・裾・座り姿の絵
  if (PHYS_BY_LAYER[n]) return physPart(L, PHYS_BY_LAYER[n]);
  // model.json の eyeAttach（レイヤーの名前の一覧。書かなければ、無し = 前と同じ）: 肌の絵から分けた、目のすぐ下の印（ほほの斜線・点）。
  // 肌の絵に入れたままだと、下を向くと、目が印の上へ滑って隠れ、上を向くと、印が口の横まで取り残される。顔の輪郭の内側だけに描く
  if ((model.eyeAttach || []).includes(n)) return eyeFollowPart(FACE);
  // ピンごとに分けた髪飾り（model.json の rigidPins。組み立ての道具の pin_split）: 1 本ずつ、留めている房に付いた固い板として動かす
  if (model.rigidPins && model.rigidPins[n]) { const f = pinFrame(n); return { cell: 40, deform: (x, y, out) => f.apply(x, y, out) }; }
  if (CLUMPS && CLUMPS[n]) return clumpPart(L, CLUMPS[n]);
  if (HFIELD && LOCKS[n]) return lockPart(L, LOCKS[n]);
  if (HFIELD && HBASES[n]) return basePart(L, HBASES[n]);
  if (path === '結び髪') {
    const grp = n === '下髪' ? 'tail' : n === 'アホ毛' ? 'ahoge' : null;
    return hairPart(L, grp, HAIR_SHELL[n], L.y + (n === 'アホ毛' ? L.h : 0), n === 'アホ毛' ? -L.h : L.h);
  }
  if (path === '後ろ髪') {
    // 後頭部と、model.json の hairRigid に名前のあるレイヤー（後ろ髪の下地など）は、頭に付けたまま動かす（ばねで揺らさない）
    // 房のモデルでは、房のほかの後ろ髪（後頭部・下地）は、頭に付けたまま
    const rigid = n === '後頭部' || !!CLUMPS || (model.hairRigid || []).includes(n);
    // 毛束のモデルでは、後頭部も、毛束・下地と同じ奥行きにする（振り向いたとき、後頭部だけずれないように）
    return hairPart(L, rigid ? null : 'back', (CLUMPS && n === '後頭部' ? SHELL.clumpBack : HFIELD && n === '後頭部' ? SHELL.back2 : HAIR_SHELL[n]) || SHELL.back2, 560, L.y + L.h - 560);
  }
  if (n === '首') {
    return { cell: 40, deform: (x0, y, out) => {
      // あごの裏に隠れている上の端は、内側へすぼめておく（あごが動いたとき、切り口の角がのぞかないように）
      // 首を上まで描いてあるモデル（model.json の neck.complete）では、すぼめない・顔と一緒に動かさない。
      // すぼめると顔を上げたとき細く見え、顔と一緒に動かすと横を向いたとき首の上だけずれる
      const x = NECK_COMPLETE ? x0 : 1500 + (x0 - 1500) * lerp(0.3, 1, sstep(985, 1130, y));
      bodyT(x, y, out);
      const w = (1 - sstep(1060, 1300, y)) * 0.55;
      if (w > 0) {
        const rx = x - PIV[0], ry = y - PIV[1];
        tmp[0] = PIV[0] + rx * pose.cr - ry * pose.sr + pose.ox;
        tmp[1] = PIV[1] + rx * pose.sr + ry * pose.cr + pose.oy;
        out[0] = lerp(out[0], tmp[0], w); out[1] = lerp(out[1], tmp[1], w);
      }
      // いちばん上（あごの裏に隠れている部分）は顔と一緒に動かす。あごが動いたとき、首の上の切り口がのぞかないように
      const hide = NECK_COMPLETE ? 0 : 1 - sstep(985, 1045, y);
      if (hide > 0) { surfMap(SKIN, x, y, tmp2); headPose(tmp2); out[0] = lerp(out[0], tmp2[0], hide); out[1] = lerp(out[1], tmp2[1], hide); }
    } };
  }
  if (path.startsWith('カーディガン') || path.startsWith('上半身')) return bodyPart(L);
  if (path === '頭/耳') return { cell: 24, deform: earDeform };
  if (path === '頭/顔/輪郭/前髪影') {
    // 前髪の影は、落ちている先は肌だが、動きは前髪についていく
    const src = byName[n.replace('影', '')] || L, root = src.y, len = src.h;
    let s = SWAY[bangsGroup(n)];
    return { cell: 40, sel1: FACE, deform: (x, y, out) => {
      s = swayByLayer[src.name] || s;   // 影は、元の前髪と同じばねで動かす
      const t = clamp((y - root) / len, 0, 1);
      const sx = x + len * (s.phi * 0.7 * Math.pow(t, 1.6) + s.phi2 * 0.5 * t * t * t);
      surfMap(SHELL.bangs, sx, y, out); headPose(out);
    } };
  }
  if (path === '頭/顔/輪郭') {
    const isLine = n === '輪郭線';
    const p = skinPart(n === '輪郭ベース' || isLine ? NONE : FACE);
    p.cell = isLine ? 20 : 24;
    const S = n === '頬' ? SHADE : SKIN;   // 顔影は輪郭の形に沿った影なので輪郭と同じ動き。頬の赤みだけ平らに上下させる
    p.deform = (x, y, out) => {
      surfMap(S, x, y, out);
      headPose(out);
    };
    return p;
  }
  if (path === '頭/顔/鼻') return groupPart(nose, 6);
  if (n === 'ほくろ') { const p = groupPart(eyes.L.group, 20); p.sel1 = FACE; return p; }
  if (n === '頬斜線') return { cell: 24, sel1: FACE, deform: (x, y, out) => cheeks[x < HX ? 0 : 1].apply(x, y, out) };
  if (path === '頭/顔') return skinPart(NONE);
  if (path.startsWith('頭/顔/瞳R')) return eyePart(L, 'R');
  if (path.startsWith('頭/顔/瞳L')) return eyePart(L, 'L');
  if (path === '頭/顔/眉毛') return browPart(L, n.endsWith('R') ? 'R' : 'L');
  // model.json の hairRigid に名前のあるレイヤー（編み込みなど）は、頭に付けたまま動かす（ばねで揺らさない）
  if (path === '頭/前髪') return hairPart(L, (model.hairRigid || []).includes(n) ? null : bangsGroup(n), CLUMPS ? SHELL.clumpFront : SHELL.bangs, L.y, L.h);
  // model.json の pinAttach が "skin" なら、髪飾りを、頭の面に沿って点ごとに動かす（頭の左右の上に 2 つある結び目のリボンなど。
  // 前髪の上のヘアピン用の pin は、奥行きが前髪と同じで、1 つの塊として動くので、頭の横の飾りは、横を向くと内側へ動きすぎる）。書かなければ前と同じ
  if (path === '頭/ピン留め') return model.pinAttach === 'skin' ? { cell: 30, deform: (x, y, out) => { surfMap(SKIN, x, y, out); headPose(out); } } : groupPart(pin, 30);
  if (path === '頭/帽子') return hairPart(L, 'bangs', SHELL.hat, L.y, L.h, HAT_SWAY);
  if (path.startsWith('表情差分')) {
    const key = n.replace(/[RL]$/, '');
    let p;
    if (/ハート|しいたけ|ぐるぐる|闇/.test(n)) p = eyePart(L, L.x + L.w / 2 < HX ? 'R' : 'L');
    else if ((model.diffAttach || {})[key] === 'eye') {
      // model.json の diffAttach: {"涙": "eye"} のように書いた差分は、目と同じ動きにする（書かなければ、肌の面に貼る = 前と同じ）。
      // 目のすぐ下に描いた涙・汗の粒を、肌の面に貼ったままにすると、斜め下で、粒が瞳の上に重なる（eyeFollowPart）
      p = eyeFollowPart(NONE);
    }
    else p = skinPart(/汗|涙/.test(n) ? NONE : FACE);
    const a0 = p.alpha || one;
    p.alpha = key === '赤面' ? () => a0() * Math.max(diffW[key] || 0, F.cheek || 0) : () => a0() * (diffW[key] || 0);
    p.diff = key;
    return p;
  }
  return null;
}

// ---- 口 --------------------------------------------------------------------
const mouth = (() => {
  const c = model.curves.mouth, lineL = byName['下唇線'], lipL = byName['リップ'], inL = byName['口内'], tongueL = byName['舌'];
  const cx = (c.xa + c.xb) / 2, hw0 = (c.xb - c.xa) / 2, n = c.Y.length;
  const yc0 = (c.Y[0] + c.Y[n - 1]) / 2;
  const restY = (x) => { const f = clamp(x - c.xa, 0, n - 1), i = Math.min(Math.floor(f), n - 2); return lerp(c.Y[i], c.Y[i + 1], f - i); };
  const sag0 = (u) => restY(cx + u * hw0) - yc0;      // 元絵の口の線のたるみ
  const restLow = Math.max(...c.Y);
  // ベクターの口用: たるみを左右対称にならして、中央の小さな折れを消す
  const sagC = (u) => sag0(clamp(u, -1, 1));
  const sagS = (u) => (sagC(u - 0.2) + sagC(u) + sagC(u + 0.2) + sagC(-u - 0.2) + sagC(-u) + sagC(-u + 0.2)) / 6;
  const group = makeGroup(cx, yc0, 0.92 * R0, 0, 0, { lead: 0.2, leadFit: MOUTH_LEAD_FIT, asym: 1.0, aw: hw0 * 0.5, fit: [FIT_Z, FIT_Z], round: MOUTH_ROUND, mouthPitch: hw0 });
  const QN = 12;                                      // 口の絵（1 枚の四角）を横に分ける数。横向きで左右を別々に伸び縮みさせるので、細かく分ける
  const N = 44, HT = 9;                               // 線の分割数、線画像の半分の太さ
  const up = new Float32Array((N + 1) * 2), lo = new Float32Array((N + 1) * 2);
  const m = {
    group, fill: stripMesh((N + 1) * 2), lineU: stripMesh((N + 1) * 2), lineD: stripMesh((N + 1) * 2),
    inside: stripMesh(4), tongue: stripMesh(4), lip: stripMesh(2 * (QN + 1)),
    tex: { line: makeTexture(lineL.img), lip: makeTexture(lipL.img), inside: makeTexture(inL.img), tongue: makeTexture(tongueL.img) },
    open: 0,
  };
  // ベクターの口（model.json の mouthVector があるとき）。毎フレーム、口の形を 2D キャンバスに曲線で描いて 1 枚の絵として貼る。
  // 画像を引き伸ばさないので、開閉してもふちがなめらか
  const vec = model.mouthVector || null;
  let vcv = null, vctx = null, vsc = 1, vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0;
  if (vec) {
    vx0 = cx - hw0 * 2.0; vx1 = cx + hw0 * 2.0; vy0 = yc0 - hw0 * 1.0; vy1 = yc0 + hw0 * (vec.style === 2 ? 2.4 : 1.8);
    const vw = vec.style === 2 ? 896 : 640;
    vsc = vw / (vx1 - vx0);
    vcv = document.createElement('canvas'); vcv.width = vw; vcv.height = Math.ceil((vy1 - vy0) * vsc);
    vctx = vcv.getContext('2d');
    m.vecQ = stripMesh(2 * (QN + 1));
    m.tex.vec = makeTexture(vcv);
  }
  // 点列をなめらかな曲線でつなぐ（中点を通る 2 次ベジェ）
  function smoothPath(ctx, pts, n, move) {
    const X = (i) => (pts[i * 2] - vx0) * vsc, Y = (i) => (pts[i * 2 + 1] - vy0) * vsc;
    if (move) ctx.moveTo(X(0), Y(0)); else ctx.lineTo(X(0), Y(0));
    for (let i = 1; i < n; i++) ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    ctx.lineTo(X(n), Y(n));
  }
  // 太さが両端で細くなる線（描いた線のような入り抜き）を、塗りつぶした形として描く
  function taperLine(ctx, pts, w0, color, alpha) {
    if (alpha <= 0.01) return;
    const L = [], Rr = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, N);
      let tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const u = -1 + (2 * i) / N, w = w0 * (0.18 + 0.82 * Math.pow(Math.max(0, 1 - u * u), 0.45)) / 2;
      L.push(pts[i * 2] - ty * w, pts[i * 2 + 1] + tx * w); Rr.push(pts[i * 2] + ty * w, pts[i * 2 + 1] - tx * w);
    }
    const rev = []; for (let i = N; i >= 0; i--) rev.push(Rr[i * 2], Rr[i * 2 + 1]);
    ctx.beginPath(); smoothPath(ctx, L, N, true); smoothPath(ctx, rev, N, false); ctx.closePath();
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawVector(O, hw, Hm, lowMax, upMin) {
    const ctx = vctx, X = (x) => (x - vx0) * vsc, Y = (y) => (y - vy0) * vsc;
    ctx.clearRect(0, 0, vcv.width, vcv.height);
    const lw = (vec.lineWidth ?? 5) * (1 + 0.25 * sstep(0, 0.4, O));
    if (O > 0.015) {
      const rev = []; for (let i = N; i >= 0; i--) rev.push(lo[i * 2], lo[i * 2 + 1]);
      ctx.save();
      ctx.beginPath(); smoothPath(ctx, up, N, true); smoothPath(ctx, rev, N, false); ctx.closePath();
      const g = ctx.createLinearGradient(0, Y(upMin), 0, Y(lowMax));
      g.addColorStop(0, vec.inside[0]); g.addColorStop(1, vec.inside[1]);
      ctx.fillStyle = g; ctx.fill();
      ctx.clip();
      // 舌: 下からせり上がる丸い形
      const tr = O * Hm * 0.5, tcy = lowMax + tr * 0.25;
      ctx.beginPath(); ctx.ellipse(X(cx), Y(tcy), hw * 0.66 * vsc, Math.max(1, tr) * vsc, 0, 0, Math.PI * 2);
      ctx.fillStyle = vec.tongue; ctx.globalAlpha = sstep(0.12, 0.4, O); ctx.fill(); ctx.globalAlpha = 1;
      // 上の歯: 上の線に沿った白い帯
      const th = Math.min(O * Hm * 0.24, (vec.teethMax ?? 13));
      if (th > 0.6) {
        const band = []; for (let i = N; i >= 0; i--) { const u = -1 + (2 * i) / N; band.push(up[i * 2], up[i * 2 + 1] + th * (0.55 + 0.45 * (1 - u * u))); }
        ctx.beginPath(); smoothPath(ctx, up, N, true); smoothPath(ctx, band, N, false); ctx.closePath();
        ctx.fillStyle = vec.teeth; ctx.fill();
      }
      ctx.restore();
      taperLine(ctx, up, lw, vec.line, sstep(0.02, 0.12, O));
    }
    taperLine(ctx, lo, lw, vec.line, 1);
    gl.bindTexture(gl.TEXTURE_2D, m.tex.vec);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vcv);
    gl.generateMipmap(gl.TEXTURE_2D);
    quad(m.vecQ, vx0, vy0, vx1, vy1);
  }
  // ---- 口の形 2（mouthVector.style = 2）--------------------------------------
  // 描き方:
  //   ・口角は丸い（上の線が口角を回り込んで、下へ行くほど細くなる）。線は黒でなく、濃いローズ色
  //   ・開いた形は、上がほぼ平らで下がすぼまる「盾」形。すぼめると丸く、笑うと上が弓なり、への字だと山形
  //   ・口の中は、上に暗い帯、下に大きな舌（明るい色から濃い色へのグラデーション）。上の歯は、上の線の下の白いレンズ形
  //   ・歯を見せる口（い・え）は、上下の歯で口の中をふさぐ
  //   ・閉じた線は、端が少し太く丸い。波（ω）を足せる
  const V2 = !!(vec && vec.style === 2);
  const hex = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };
  const v2 = { O: 0, Hc: 0, hw: 0, yTop: 0, yBot: 0, Rd: 0, Tt: 0, closed: 1 };
  function shape2() {
    const O = clamp(F.mouthOpen, 0, 1), form = F.mouthForm, Fp = Math.max(form, 0), Fn = Math.max(-form, 0), Wd = F.mouthWidth;
    const Rd = clamp(F.mouthRound, 0, 1), Tt = clamp(F.mouthTeeth, 0, 1), Wv = clamp(F.mouthWave, 0, 1);
    const Tp = clamp(F.mouthTop, -1, 1), Pt = clamp(F.mouthPoint, 0, 1);
    // 表情のぶんの口の形は、口角の上がり下がりだけに効かせる。幅・開きの大きさ・まん中の高さは、表情を足す前の形（fb）で決める
    const fb = F.mouthFormBase ?? form, Bp = Math.max(fb, 0), Bn = Math.max(-fb, 0), kfB = fb >= 0 ? 1 + 0.6 * Bp : 1 - 1.9 * Bn;
    const hw = hw0 * Wd * (1 + 0.14 * Bp - 0.08 * Bn);
    const Hc = O * hw0 * (vec.openMax ?? 1.45) * (1 - 0.25 * Bn) * (0.75 + 0.25 * Math.min(Wd, 1.1) + 0.2 * Rd);   // 中央の開き
    const yk = yc0 - 6 * Fp + 7 * Fn - 0.06 * Hc;                           // 口角の高さ
    const kf = form >= 0 ? 1 + 0.6 * Fp : 1 - 1.9 * Fn;                     // 閉じた線のたるみ（マイナスでへの字）
    const q = lerp(4.5, 2, Rd), aUp = Hc * (0.08 + 0.3 * Rd + 0.3 * Fn + 0.3 * Math.max(Tp, 0)), aSm = Hc * (0.16 * Fp + 0.25 * Math.max(-Tp, 0));
    const pw = lerp(lerp(lerp(lerp(2.1, 2.6, Fp), 3, Fn), 2, Rd), 1.35, Pt), pe = lerp(lerp(0.58, 0.5, Rd), 0.8, Pt);
    const cr = Math.max(Rd, Tt, vec.cornerRound ?? 0.12);                   // 口角の丸さ（すぼめた口・歯を見せる口は丸い。ほかは、とがる）
    const closed = 1 - sstep(0, 0.22, O);
    let lowMax = -1e9, upMin = 1e9;
    for (let i = 0; i <= N; i++) {
      const u = -Math.cos((Math.PI * i) / N), au = Math.abs(u);            // 口角の近くを細かく取る
      const cs = 1 - Math.sqrt(Math.max(0, 1 - Math.pow(au, q)));          // 中央 0 → 口角 1（口角で縦に立つ）
      const wave = -Wv * hw * 0.11 * (Math.cos(2 * Math.PI * u) - 0.25) * (1 - u * u) * closed;
      const rc = Hc * 0.13 * cr * (1 - Math.sqrt(Math.max(0, 1 - Math.pow(au, 9))));   // 口角のすぐ手前で下へ回り込ませる（開いた口の口角を丸くする）
      const yu = yk + sagS(u) * kf * (1 - 0.85 * sstep(0, 0.5, O)) * (1 - 0.85 * Rd * sstep(0, 0.2, O)) + wave - aUp * (1 - cs) + aSm * (1 - 0.8 * Rd) * (1 - u * u) + rc;
      const yl = yu + Hc * Math.pow(Math.max(0, 1 - Math.pow(au, pw)), pe);
      up[i * 2] = lo[i * 2] = cx + u * hw;
      up[i * 2 + 1] = yu; lo[i * 2 + 1] = yl;
      lowMax = Math.max(lowMax, yl); upMin = Math.min(upMin, yu);
    }
    const mid = N >> 1;
    // 上下の位置: 開いた口は、閉じた線の高さを基準に、開きの mouthLift ぶんだけ上へ、残りは下へ広がる
    // （前は口角の高さが基準で、上の線が山なりの口（「お」など）は、上へだけ広がって見えた）
    const restC = yc0 + sagS(0) * kfB, wOpen = sstep(0, 0.25, O);
    // 閉じた口: 線のまん中の高さを、表情を足す前と同じにする（口角だけが上下する）
    const keep = (yc0 - 6 * Bp + 7 * Bn + sagS(0) * kfB) - (yc0 - 6 * Fp + 7 * Fn + sagS(0) * kf);
    const dyAll = ((restC - clamp(F.mouthLift, 0, 1) * Hc) - up[mid * 2 + 1]) * wOpen + keep * (1 - wOpen) + F.mouthY * hw0 * 0.5;
    for (let i = 0; i <= N; i++) { up[i * 2 + 1] += dyAll; lo[i * 2 + 1] += dyAll; }
    lowMax += dyAll; upMin += dyAll;
    Object.assign(v2, { O, Hc, hw, yTop: up[mid * 2 + 1], yBot: lo[mid * 2 + 1], Rd, Tt, closed, lowMax, upMin });
  }
  // 太さを場所ごとに決められる線。wf(u) は太さ（u は -1〜1）
  function varLine(ctx, pts, wf, color, alpha) {
    if (alpha <= 0.01) return;
    const L = [], Rr = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, N);
      let tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const w = wf(-Math.cos((Math.PI * i) / N)) / 2;
      L.push(pts[i * 2] - ty * w, pts[i * 2 + 1] + tx * w); Rr.push(pts[i * 2] + ty * w, pts[i * 2 + 1] - tx * w);
    }
    const rev = []; for (let i = N; i >= 0; i--) rev.push(Rr[i * 2], Rr[i * 2 + 1]);
    ctx.beginPath(); smoothPath(ctx, L, N, true); smoothPath(ctx, rev, N, false); ctx.closePath();
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  }
  // ---- 口の差分シート（口コマ1〜9: 閉じ・あ・い・う・え・お・小さく開いた口・笑っている口・への字）があるモデルは、
  // 式で描く口の代わりに、描かれた口の絵を切り替えて見せる（アニメの口パクと同じ。キャラごとの口の形になる）。
  // 絵は、ベクターの口と同じキャンバスへ描くので、顔の向きの変形・顔の輪郭での切り抜きは、今までと同じ
  const sheetL = {}; for (let k = 1; k <= 9; k++) { const L = byName['口コマ' + k]; if (L && L.img) sheetL[k] = L; }
  const hasSheet = !!(vec && sheetL[1] && sheetL[2]);
  const sheetW = new Float32Array(10);
  const SHEET_NOM = { 2: 0.6, 3: 0.26, 4: 0.4, 5: 0.45, 6: 0.62, 7: 0.28, 8: 0.92 };   // その絵が、いちばん合う開き
  function drawSheet() {
    const ctx = vctx, X = (x) => (x - vx0) * vsc, Y = (y) => (y - vy0) * vsc;
    ctx.clearRect(0, 0, vcv.width, vcv.height);
    const O = clamp(F.mouthOpen, 0, 1), form = F.mouthForm, Rd = clamp(F.mouthRound, 0, 1), Tt = clamp(F.mouthTeeth, 0, 1);
    const v = (typeof lipNow !== 'undefined' && lipNow.top) || '';   // 口パクで、いま いちばん強い母音
    let k;
    if (O < 0.07) k = form < -0.3 ? 9 : 1;
    else if (v === 'i' || (!v && Tt > 0.55 && O < 0.45)) k = 3;
    else if (v === 'u' || (!v && Rd > 0.6 && O < 0.5)) k = 4;
    else if (v === 'o' || (!v && Rd > 0.6)) k = 6;
    else if (v === 'e') k = O < 0.22 ? 7 : 5;
    else k = O < 0.3 ? 7 : O < 0.84 ? 2 : 8;
    if (!sheetL[k]) k = O < 0.07 ? 1 : 2;
    let k1 = 0, k2 = 0;
    for (let i = 1; i <= 9; i++) {
      sheetW[i] += ((i === k ? 1 : 0) - sheetW[i]) * 0.5;         // 1〜2 コマで切り替える
      if (!k1 || sheetW[i] > sheetW[k1]) { k2 = k1; k1 = i; } else if (!k2 || sheetW[i] > sheetW[k2]) k2 = i;
    }
    const put = (i, a) => {
      const L = sheetL[i]; if (!L || a < 0.03) return;
      // 開きに合わせて、上のふちを動かさずに、縦に少しだけ伸び縮みさせる（絵と絵のあいだを、なめらかにつなぐ）
      const nom = SHEET_NOM[i], sy = nom ? clamp(lerp(1, O / nom, 0.45), 0.82, 1.15) : 1;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(L.img, X(L.x), Y(L.y), L.w * vsc, L.h * vsc * sy);
    };
    put(k1, 1);
    if (k2 && k2 !== k1) put(k2, sheetW[k2] / Math.max(sheetW[k1], 1e-3));
    ctx.globalAlpha = 1;
    gl.bindTexture(gl.TEXTURE_2D, m.tex.vec);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vcv);
    gl.generateMipmap(gl.TEXTURE_2D);
    quad(m.vecQ, vx0, vy0, vx1, vy1);
  }
  function drawVector2() {
    if (hasSheet) return drawSheet();
    const ctx = vctx, X = (x) => (x - vx0) * vsc, Y = (y) => (y - vy0) * vsc;
    const { O, Hc, hw, yTop, yBot, Rd, Tt, closed } = v2;
    ctx.clearRect(0, 0, vcv.width, vcv.height);
    const lw = (vec.lineWidth ?? 5) * (1 + 0.15 * sstep(0, 0.4, O));
    const openA = 1 - closed;
    const gl0 = vec.gloss ?? 0.6;
    if (gl0 > 0.01) {
      const gy = Y(v2.lowMax + lw * 0.5 + hw0 * 0.1), gr = hw0 * 0.62 * vsc, gx = X(cx);
      const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      gg.addColorStop(0, vec.glossColor || 'rgba(255,150,165,0.42)'); gg.addColorStop(1, 'rgba(255,150,165,0)');
      ctx.save(); ctx.globalAlpha = gl0; ctx.translate(0, gy); ctx.scale(1, 0.55); ctx.translate(0, -gy);
      ctx.fillStyle = gg; ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2); ctx.restore();
      ctx.globalAlpha = gl0; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(gx, Y(v2.lowMax + lw * 0.5 + hw0 * 0.11), hw0 * 0.075 * vsc, hw0 * 0.04 * vsc, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const tongueLight = vec.tongueLight || mix(vec.tongue, '#ffe3d2', 0.5), lowLine = vec.lowLine || mix(vec.line, vec.tongue, 0.35);
    if (O > 0.012) {
      const rev = []; for (let i = N; i >= 0; i--) rev.push(lo[i * 2], lo[i * 2 + 1]);
      ctx.save();
      ctx.beginPath(); smoothPath(ctx, up, N, true); smoothPath(ctx, rev, N, false); ctx.closePath();
      const g = ctx.createLinearGradient(0, Y(yTop), 0, Y(yBot));
      g.addColorStop(0, vec.inside[0]); g.addColorStop(1, vec.inside[1]);
      ctx.fillStyle = g; ctx.fill();
      ctx.clip();
      // 舌: 口の下側を大きく占める。小さく開いた口は、ほぼ全部が舌の色
      const band = Hc * lerp(0.2, 0.44, sstep(0.2, 0.7, O));
      const tTop = yTop + band, ry = Math.max(2, yBot - tTop) * 1.1, rx = hw * 1.04;
      const tg = ctx.createLinearGradient(0, Y(tTop), 0, Y(yBot));
      tg.addColorStop(0, tongueLight); tg.addColorStop(1, vec.tongue);
      ctx.beginPath(); ctx.ellipse(X(cx), Y(tTop + ry), rx * vsc, ry * vsc, 0, 0, Math.PI * 2);
      ctx.fillStyle = tg; ctx.fill();
      const hr = hw * 0.55 * vsc, hx = X(cx - hw * 0.12), hy = Y(tTop + (yBot - tTop) * 0.42);
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, 'rgba(255,255,255,0.20)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg; ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
      // 上の歯: 上の線のすぐ下の、白いレンズ形
      // 下の歯（両わきの小さな白）: 大きく開いた、すぼめていない口だけ
      const sa = sstep(0.5, 0.75, O) * (1 - Rd) * (1 - Tt) * sstep(0.85, 1.0, hw / hw0);
      if (sa > 0.01) {
        ctx.globalAlpha = sa; ctx.fillStyle = vec.teeth;
        for (const sg of [-1, 1]) { ctx.beginPath(); ctx.ellipse(X(cx + sg * hw * 0.66), Y(tTop + (yBot - tTop) * 0.2), hw * 0.055 * vsc, hw * 0.085 * vsc, sg * 0.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      // 上の歯: 上の線に沿った、白い三日月
      const ta = sstep(0.16, 0.4, O) * (1 - Tt);
      if (ta > 0.01) {
        const th = Math.min(Hc * 0.15, vec.teethMax ?? 16), cres = [];
        for (let i = N; i >= 0; i--) { const u = -Math.cos((Math.PI * i) / N); cres.push(up[i * 2], up[i * 2 + 1] + th * Math.pow(Math.max(0, 1 - Math.pow(u / 0.86, 2)), 0.7)); }
        ctx.globalAlpha = ta; ctx.fillStyle = vec.teeth;
        ctx.beginPath(); smoothPath(ctx, up, N, true); smoothPath(ctx, cres, N, false); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // 八重歯: 上の線から下がる、小さな三角（画面右側）。口を開けたときだけ見える
      const Fg = clamp(F.mouthFang, 0, 1) * sstep(0.1, 0.3, O) * (1 - Tt);
      if (Fg > 0.02) {
        const yUp = (u) => { const f = clamp((N * Math.acos(clamp(-u, -1, 1))) / Math.PI, 0, N - 1e-6), i = Math.floor(f); return lerp(up[i * 2 + 1], up[i * 2 + 3], f - i); };
        const u0 = 0.36, u1 = 0.64, fh = Math.min(Hc * 0.46, hw * 0.34);
        ctx.globalAlpha = Fg; ctx.fillStyle = vec.teeth;
        ctx.beginPath();
        ctx.moveTo(X(cx + u0 * hw), Y(yUp(u0) - 1));
        ctx.lineTo(X(cx + u1 * hw), Y(yUp(u1) - 1));
        ctx.quadraticCurveTo(X(cx + (u0 * 0.35 + u1 * 0.65) * hw), Y(yUp(0.5) + fh * 0.55), X(cx + (u0 * 0.55 + u1 * 0.45) * hw), Y(yUp(0.5) + fh));
        ctx.quadraticCurveTo(X(cx + (u0 * 0.8 + u1 * 0.2) * hw), Y(yUp(0.5) + fh * 0.45), X(cx + u0 * hw), Y(yUp(u0) - 1));
        ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
      // 歯を見せる口: 上下の歯で口の中をふさぐ
      if (Tt > 0.02) {
        const bu = [], bl = [];
        for (let i = N; i >= 0; i--) { const u = -Math.cos((Math.PI * i) / N), k = 0.75 + 0.25 * (1 - u * u); bu.push(up[i * 2], up[i * 2 + 1] + Tt * Hc * 0.56 * k); bl.push(lo[i * 2], lo[i * 2 + 1] - sstep(0.5, 0.9, Tt) * Hc * 0.5 * k); }
        ctx.fillStyle = vec.teeth;
        ctx.beginPath(); smoothPath(ctx, up, N, true); smoothPath(ctx, bu, N, false); ctx.closePath(); ctx.fill();
        ctx.beginPath(); smoothPath(ctx, lo, N, true); smoothPath(ctx, bl, N, false); ctx.closePath(); ctx.fill();
        // かみ合わせの線（薄く）
        const mid = []; for (let i = 0; i <= N; i++) mid.push(up[i * 2], up[i * 2 + 1] + Tt * Hc * 0.56 * (0.75 + 0.25 * (1 - Math.pow(Math.cos((Math.PI * i) / N), 2))));
        varLine(ctx, mid, () => lw * 0.3, mix(vec.line, vec.teeth, 0.55), sstep(0.5, 0.9, Tt) * 0.8);
      }
      ctx.restore();
      // 輪郭: 下の線は、口角で太く、下へ行くほど細く薄い。上の線は太いまま口角を回り込む
      const lowW = vec.lowWidth ?? 0.72;
      varLine(ctx, lo, (u) => lw * (lowW + (1 - lowW) * Math.pow(Math.abs(u), 2.2)), vec.line, openA);
      varLine(ctx, up, () => lw, vec.line, openA);
      // 口角: 上下の線の端を、丸でつなぐ（端が角ばって飛び出さないように）
      ctx.globalAlpha = openA; ctx.fillStyle = vec.line;
      for (const i of [0, N]) { ctx.beginPath(); ctx.arc(X(up[i * 2]), Y(up[i * 2 + 1]), lw * 0.5 * vsc, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    const Tg = clamp(F.mouthTongue, 0, 1) * closed;
    if (Tg > 0.02) {
      // 舌を出す: 閉じた線のまん中より少し画面右の下に、舌の先（半分の だ円）。線は上から重ねて描く
      const ut = 0.18, f = clamp((N * Math.acos(-ut)) / Math.PI, 0, N - 1e-6), it = Math.floor(f);
      const ty = lerp(lo[it * 2 + 1], lo[it * 2 + 3], f - it), tx = cx + ut * hw, rx = hw * 0.27, ry = hw * 0.36 * Tg;
      const tg2 = ctx.createLinearGradient(0, Y(ty), 0, Y(ty + ry));
      tg2.addColorStop(0, vec.tongue); tg2.addColorStop(1, tongueLight);
      ctx.globalAlpha = Math.min(1, Tg * 3);
      ctx.beginPath(); ctx.ellipse(X(tx), Y(ty), rx * vsc, ry * vsc, 0, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = tg2; ctx.fill();
      ctx.lineWidth = lw * 0.7 * vsc; ctx.strokeStyle = lowLine; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.ellipse(X(tx), Y(ty), rx * vsc, ry * vsc, 0, 0, Math.PI); ctx.stroke();
      ctx.lineWidth = lw * 0.35 * vsc; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(tx), Y(ty + ry * 0.2)); ctx.lineTo(X(tx), Y(ty + ry * 0.62)); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (closed > 0.01) {
      // 閉じた線: 端が少し太く、丸く止まる
      varLine(ctx, lo, (u) => lw * (0.78 + 0.3 * Math.pow(Math.abs(u), 4)), vec.line, closed);
      ctx.globalAlpha = closed; ctx.fillStyle = vec.line;
      for (const i of [0, N]) { ctx.beginPath(); ctx.arc(X(lo[i * 2]), Y(lo[i * 2 + 1]), lw * (0.5 + 0.22 * (vec.cornerDot ?? 0.6)) * vsc, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, m.tex.vec);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vcv);
    gl.generateMipmap(gl.TEXTURE_2D);
    quad(m.vecQ, vx0, vy0, vx1, vy1);
  }
  const out = [0, 0];
  function quad(mesh, x0, y0, x1, y1) {
    if (mesh.pos.length >= 4 * (QN + 1)) {   // 横に細かく分けた四角
      for (let i = 0; i <= QN; i++) for (let s = 0; s < 2; s++) {
        const k = i * 2 + s, u = i / QN;
        group.apply(lerp(x0, x1, u), s ? y1 : y0, out);
        mesh.pos[k * 2] = out[0]; mesh.pos[k * 2 + 1] = out[1];
        mesh.uv[k * 2] = u; mesh.uv[k * 2 + 1] = s;
      }
      for (let i = 0; i < QN; i++) { const a = i * 2; mesh.idx.set([a, a + 2, a + 1, a + 2, a + 3, a + 1], i * 6); }
      uploadAll(mesh, 2 * (QN + 1), QN * 6);
      return;
    }
    const P = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    for (let i = 0; i < 4; i++) {
      group.apply(P[i][0], P[i][1], out);
      mesh.pos[i * 2] = out[0]; mesh.pos[i * 2 + 1] = out[1];
      mesh.uv[i * 2] = i % 2; mesh.uv[i * 2 + 1] = i < 2 ? 0 : 1;
    }
    mesh.idx.set([0, 1, 2, 1, 3, 2]);
    uploadAll(mesh, 4, 6);
  }
  // 曲線 pts に沿って線の画像を貼る。開くほど画像の両端（細くなる部分）を使わない
  function line(mesh, pts, thick, trim) {
    for (let i = 0; i <= N; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, N);
      let tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const texX = lerp(c.xa, c.xb, lerp(trim, 1 - trim, i / N)), texY = restY(texX);
      for (let s = 0; s < 2; s++) {
        const d = (s ? 1 : -1) * HT, k = i * 2 + s;
        group.apply(pts[i * 2] - ty * d * thick, pts[i * 2 + 1] + tx * d * thick, out);
        mesh.pos[k * 2] = out[0]; mesh.pos[k * 2 + 1] = out[1];
        mesh.uv[k * 2] = (texX - lineL.x) / lineL.w; mesh.uv[k * 2 + 1] = (texY + d - lineL.y) / lineL.h;
      }
    }
    let ni = 0;
    for (let i = 0; i < N; i++) { const k = i * 2; mesh.idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], ni); ni += 6; }
    uploadAll(mesh, (N + 1) * 2, ni);
  }
  m.update = () => {
    const O = F.mouthOpen, Fp = Math.max(F.mouthForm, 0), Fn = Math.max(-F.mouthForm, 0), Wd = F.mouthWidth;
    m.open = O;
    group.update();
    if (V2) {
      shape2();
      const f2 = m.fill;
      for (let i = 0; i <= N; i++) {
        group.apply(up[i * 2], up[i * 2 + 1], out); f2.pos[i * 4] = out[0]; f2.pos[i * 4 + 1] = out[1];
        group.apply(lo[i * 2], lo[i * 2 + 1], out); f2.pos[i * 4 + 2] = out[0]; f2.pos[i * 4 + 3] = out[1];
      }
      let n2 = 0;
      for (let i = 0; i < N; i++) { const k = i * 2; f2.idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], n2); n2 += 6; }
      uploadAll(f2, (N + 1) * 2, n2);
      const sx2 = v2.hw / hw0, dy2 = v2.lowMax - restLow;
      quad(m.lip, cx + (lipL.x - cx) * sx2, lipL.y + dy2, cx + (lipL.x + lipL.w - cx) * sx2, lipL.y + lipL.h + dy2);
      drawVector2(); return;
    }
    const hw = hw0 * Wd * (1 + 0.14 * Fp + 0.12 * O * Fp - 0.1 * Fn);
    const yc = yc0 - 5 * Fp + 6 * Fn - 3 * O;                         // 口角の高さ
    const kf = F.mouthForm >= 0 ? 1 + 0.6 * Fp : 1 - 1.9 * Fn;        // 閉じた線のたるみ（マイナスでへの字）
    const Hm = 72 * (1 - 0.4 * Fn) * (0.7 + 0.3 * Math.min(Wd, 1.1)); // いちばん開いたときの高さ
    const narrow = clamp((1 - Wd) / 0.5, 0, 1);                       // すぼめた口（「お」「う」）
    const pw = lerp(lerp(2.3, 2.8, Fp), 2, narrow), pe = lerp(lerp(0.62, 0.55, Fp), 0.5, narrow);   // 笑うほど下側が丸い D 形になる
    let lowMax = -1e9, upMin = 1e9;
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N, arch = 1 - u * u;
      const yu = yc + (vec ? sagS(u) : sag0(u)) * kf * (1 - 0.85 * O) - O * (2 + 14 * Fn + 34 * narrow) * arch;
      const yl = yu + O * Hm * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), pw)), pe);
      up[i * 2] = lo[i * 2] = cx + u * hw;
      up[i * 2 + 1] = yu; lo[i * 2 + 1] = yl;
      lowMax = Math.max(lowMax, yl); upMin = Math.min(upMin, yu);
    }
    // 口の中のマスク（上下の線に挟まれた形）
    const f = m.fill;
    for (let i = 0; i <= N; i++) {
      group.apply(up[i * 2], up[i * 2 + 1], out); f.pos[i * 4] = out[0]; f.pos[i * 4 + 1] = out[1];
      group.apply(lo[i * 2], lo[i * 2 + 1], out); f.pos[i * 4 + 2] = out[0]; f.pos[i * 4 + 3] = out[1];
    }
    let ni = 0;
    for (let i = 0; i < N; i++) { const k = i * 2; f.idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], ni); ni += 6; }
    uploadAll(f, (N + 1) * 2, ni);
    if (vec) {
      // ベクターの口でも、唇の塗り（リップ）があれば口と一緒に動かす（無いモデルは透明のダミーなので何も出ない）
      const sxv = hw / hw0, dyv = lowMax - restLow;
      quad(m.lip, cx + (lipL.x - cx) * sxv, lipL.y + dyv, cx + (lipL.x + lipL.w - cx) * sxv, lipL.y + lipL.h + dyv);
      drawVector(O, hw, Hm, lowMax, upMin); return;
    }
    quad(m.inside, cx - hw - 10, upMin - 10, cx + hw + 10, lowMax + 10);
    const tw = hw * 1.15, th = tw * 0.52, ttop = lowMax - Math.min(th * 0.8, O * Hm * 0.42);
    quad(m.tongue, cx - tw, ttop, cx + tw, ttop + th * 2 * 0.52);
    const sx = hw / hw0, dy = lowMax - restLow;
    quad(m.lip, cx + (lipL.x - cx) * sx, lipL.y + dy, cx + (lipL.x + lipL.w - cx) * sx, lipL.y + lipL.h + dy);
    const thick = 1 + 0.3 * sstep(0, 0.4, O), trim = 0.22 * sstep(0, 0.35, O);
    line(m.lineD, lo, thick, trim);
    line(m.lineU, up, thick, trim);
  };
  m.drawMask = () => { drawRaw(m.fill, WHITE, 1); };
  m.draw = () => {
    const O = m.open;
    if (vec) { setMask(FACE, NONE); drawRaw(m.lip, m.tex.lip, byName['リップ'].opacity * (1 - sstep(0, 0.35, O))); drawRaw(m.vecQ, m.tex.vec, 1); return; }
    if (O > 0.01) {
      setMask(MOUTH, FACE);
      drawRaw(m.inside, m.tex.inside, 1);
      drawRaw(m.tongue, m.tex.tongue, sstep(0.3, 0.65, O));
    }
    setMask(FACE, NONE);
    drawRaw(m.lip, m.tex.lip, byName['リップ'].opacity * (1 - sstep(0, 0.35, O)));
    drawRaw(m.lineD, m.tex.line, 1);
    drawRaw(m.lineU, m.tex.line, sstep(0.02, 0.12, O));
  };
  return m;
})();

// ---- キーの形で動く目・口（model.json の keyEye・keyMouth。js/keyshape.js）------------
const KS = (model.keyEye || model.keyMouth) ? (await import('./keyshape.js?v=' + JS_V)).setupKeyShapes({ gl, model, byName, eyes, makeTexture, makeMesh, drawRaw: (m, t, a) => drawRaw(m, t, a), clamp, lerp, sstep }) : null;
if (KS && model.keyEye) for (const k of ['R', 'L']) eyes[k].ke = KS.makeKeyEye(k);
const keyMouth = KS && model.keyMouth ? KS.makeKeyMouth(mouth.group) : null;
// 口のキーの重みの決め方（表情 → 口パク → 手動の「口の開き」の順に重ねる）
const kmT = {}, exMouth = {};                    // 目標の重み / 表情のぶん（なめらかに追いかけた値）
let kmDirect = null;                             // 台本（決まった動きの再生）が、口のキーの重みを直接決めるとき。null なら、表情と母音から決める
const kmVow = { a: 0, i: 0, u: 0, e: 0, o: 0, vol: 0 };
function keyMouthStep(dt) {
  const km = keyMouth, names = km.names;
  if (kmDirect) { km.step(kmDirect, dt, 60); return; }
  // 表情のぶん
  const em = (EXPR[exprName] && EXPR[exprName].mouth) || { closed: 1 };
  const k = dt > 1e-5 ? 1 - Math.exp(-dt * 13) : 1;
  let se = 0;
  for (const nm of names) { const c0 = exMouth[nm] ?? (nm === 'closed' ? 1 : 0); exMouth[nm] = c0 + ((em[nm] || 0) - c0) * k; se += exMouth[nm]; }
  for (const nm of names) kmT[nm] = exMouth[nm] / (se || 1);
  // 口角が下がる値（mouthForm がマイナス）は、への字へ
  const neg = km.has('he') ? sstep(0.25, 0.8, -(cur.mouthForm - (P_OF.mouthForm ? P_OF.mouthForm.def : 0))) : 0;
  if (neg > 0) { for (const nm of names) kmT[nm] *= 1 - neg; kmT.he = (kmT.he || 0) + neg; }
  // 口パク（母音）と、手動の「口の開き」
  const v = clamp(kmVow.vol * 1.2, 0, 1), vs = kmVow.a + kmVow.i + kmVow.u + kmVow.e + kmVow.o;
  if (v > 0.01 && vs > 0.01) {
    for (const nm of names) kmT[nm] *= 1 - v;
    for (const c of ['a', 'i', 'u', 'e', 'o']) if (km.has(c)) kmT[c] = (kmT[c] || 0) + v * kmVow[c] / vs;
  } else if (cur.mouthOpen > 0.01 && !Object.keys(em).some((n) => n !== 'closed' && km.K[n] && km.K[n].open)) {
    // 閉じた口（closed）は、歯が見える絵柄（ギザ歯など）でも、口の開きで開ける（中が見えるキーとして数えると、開きが効かなかった）
    const O = clamp(cur.mouthOpen, 0, 1), a = km.has('small') ? 'small' : 'a', hl = km.has('laugh');
    const wS = O < 0.4 ? O / 0.4 : O < 0.75 ? 1 - (O - 0.4) / 0.35 : 0;
    const wA = O < 0.4 ? 0 : O < 0.75 ? (O - 0.4) / 0.35 : hl ? 1 - (O - 0.75) / 0.25 : 1;
    const wL = O > 0.75 && hl ? (O - 0.75) / 0.25 : 0;
    const tot = Math.min(wS + wA + wL, 1);
    for (const nm of names) kmT[nm] *= 1 - tot;
    kmT[a] = (kmT[a] || 0) + wS; kmT.a = (kmT.a || 0) + wA; if (wL) kmT.laugh = (kmT.laugh || 0) + wL;
  }
  km.step(kmT, dt, dt > 1e-5 ? 30 : 1e9);
}
// キーの絵を重ねる用の描画先（画面と同じ大きさ）。足して 1 になる重みで加算してから、画面へ重ねる
const layerTex = gl.createTexture(), layerFbo = gl.createFramebuffer();
const fsQuad = makeMesh(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), new Uint16Array([0, 1, 2, 1, 3, 2]));
function makeLayer(drawFn, sel1, sel2, alpha = 1) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, layerFbo);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(U.uMode, 0); gl.blendFunc(gl.ONE, gl.ONE);
  setMask(NONE, NONE);
  drawFn();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  setBlend(false); setMask(sel1, sel2);
  gl.uniform4f(U.uView, 0, 0, 1, 1);
  drawRaw(fsQuad, layerTex, alpha);
  gl.uniform4f(U.uView, VIEW.cx, VIEW.cy, 1 / (VIEW.half * (view.width / view.height)), 1 / VIEW.half);
}

// ---- 描画リストを組む ------------------------------------------------------
const draws = [];      // 描く順
const parts = [];      // 毎フレーム頂点を更新するもの
function addPart(L) {
  const p = classify(L);
  if (!p) return null;
  p.L = L;
  p.mesh = gridMesh(L, p.cell);
  p.tex = makeTexture(L.img);
  p.alpha = p.alpha || one;
  p.sel1 = p.sel1 || NONE; p.sel2 = p.sel2 || NONE;
  parts.push(p);
  return p;
}
{
  const diffs = LAYERS.filter((L) => L.path.startsWith('表情差分')).map(addPart);
  const irisDiff = (key) => diffs.filter((p) => p.sel2 !== NONE && (key === 'R' ? p.sel2 === EYE_R : p.sel2 === EYE_L));
  const faceDiff = diffs.filter((p) => p.sel2 === NONE);
  let mouthDone = false, diffDone = false;
  const browParts = [];
  const keyDone = {};
  for (const L of LAYERS) {
    if (L.path.startsWith('表情差分')) continue;
    if (L.name.startsWith('目キー_')) {   // キーの形の目の絵。左右それぞれ、最初の 1 枚の位置で、まとめて描く
      const k = L.name.endsWith('R') ? 'R' : 'L';
      if (eyes[k].ke && !keyDone[k]) { keyDone[k] = true; draws.push({ keyEye: k }); }
      continue;
    }
    if (L.path.startsWith('頭/顔/口')) { if (!mouthDone) { draws.push({ mouth: true }); mouthDone = true; } continue; }
    if (L.path === '頭/前髪' && !diffDone) { diffDone = true; for (const p of faceDiff) draws.push({ p }); }   // 差分は眉の上・前髪（いちばん下のレイヤー）の下
    const p = addPart(L);
    if (!p) continue;
    draws.push({ p });
    if (L.name === 'ハイライト1R') for (const d of irisDiff('R')) draws.push({ p: d });
    if (L.name === 'ハイライト1L') for (const d of irisDiff('L')) draws.push({ p: d });
    if (L.path === '頭/顔/眉毛') browParts.push(p);
  }
  // まつげを、髪の上にも重ねる（キーの形の目だけ。model.json の lashOver）
  const lashOver = q.has('lashOver') ? +q.get('lashOver') : model.lashOver;   // ?lashOver= で試せる
  if (lashOver > 0) for (const k of ['R', 'L']) if (eyes[k].ke) draws.push({ keyEye: k, over: lashOver });
  // 眉は髪の上にも重ねて描ける（怒り・蔑むで、眉の角度が、髪に隠れずに見えるように）
  for (const p of browParts) draws.push({ p, alpha: () => F.browShow * 0.92, tint: Array.isArray(model.browTint) ? model.browTint : null });
}
const pFace = parts.find((p) => p.L.name === '輪郭ベース');
const pWhiteR = parts.find((p) => p.L.name === '白目R'), pWhiteL = parts.find((p) => p.L.name === '白目L');

// ---- マスク用の描画先 ------------------------------------------------------
const maskTex = gl.createTexture();
const maskFbo = gl.createFramebuffer();
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(innerWidth * dpr)), h = Math.max(2, Math.round(innerHeight * dpr));
  if (view.width === w && view.height === h) return;
  view.width = w; view.height = h;
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, maskTex, 0);
  gl.bindTexture(gl.TEXTURE_2D, layerTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, layerFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
addEventListener('resize', resize);
resize();

function setMask(s1, s2) { gl.uniform4fv(U.uSel1, s1); gl.uniform4fv(U.uSel2, s2); }
function drawRaw(mesh, tex, alpha) {
  if (alpha <= 0.003) return;
  gl.uniform1f(U.uAlpha, alpha);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
}
function setBlend(multiply) {
  gl.uniform1i(U.uMode, multiply ? 1 : 0);
  if (multiply) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
  else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

// 表示範囲（PSD 座標）。縦を基準にして、横は画面の縦横比ぶん広げる
// model.json の view（cx・cy・zoom）があれば、それを初期値にする（頭頂より上に帽子があるキャラなど）。URL の指定が優先
const MV = model.view || {};
const VIEW = { cx: +(q.get('cx') || MV.cx || 1500), cy: +(q.get('cy') || MV.cy || 1010), half: 1060 / +(q.get('zoom') || MV.zoom || 1) };
// ---- 配置（位置と大きさ）をマウスで変える ------------------------------------
//   ドラッグ: 位置を動かす / ホイール: カーソルの場所を中心に大きさを変える / ダブルクリック: 初期の配置に戻す
// 配置はモデルごとにブラウザへ保存する。URL で cx・cy・zoom を指定したとき（確認用の撮影など）は、保存した配置を使わない
{
  const VIEW0 = { cx: VIEW.cx, cy: VIEW.cy, half: VIEW.half }, VKEY = MODEL_NAME + '.view.v1';
  const fixedView = q.has('cx') || q.has('cy') || q.has('zoom');
  if (!fixedView) {
    try { const v = JSON.parse(localStorage.getItem(VKEY) || 'null'); if (v && [v.cx, v.cy, v.half].every((n) => typeof n === 'number' && isFinite(n))) Object.assign(VIEW, { cx: v.cx, cy: v.cy, half: clamp(v.half, 60, 6000) }); } catch (e) { /* 保存が使えない環境では初期の配置 */ }
  }
  const saveView = () => { if (!fixedView) try { localStorage.setItem(VKEY, JSON.stringify(VIEW)); } catch (e) { /* 保存できなくても動作は続ける */ } };
  const upp = () => (2 * VIEW.half) / innerHeight;          // 画面の 1 ピクセルが、モデルの座標でいくつか
  let drag = null;
  view.style.cursor = 'grab'; view.style.touchAction = 'none';
  view.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); view.style.cursor = 'grabbing'; });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = upp();
    VIEW.cx -= (e.clientX - drag.x) * k; VIEW.cy -= (e.clientY - drag.y) * k;
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = () => { if (drag) { drag = null; view.style.cursor = 'grab'; saveView(); } };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k0 = upp(), px = e.clientX - innerWidth / 2, py = e.clientY - innerHeight / 2;
    const wx = VIEW.cx + px * k0, wy = VIEW.cy + py * k0;          // カーソルの下にある、モデルの点
    VIEW.half = clamp(VIEW.half * Math.exp(e.deltaY * 0.0012), 60, 6000);
    const k1 = upp();
    VIEW.cx = wx - px * k1; VIEW.cy = wy - py * k1;
    saveView();
  }, { passive: false });
  const resetView = () => { Object.assign(VIEW, VIEW0); saveView(); };
  view.addEventListener('dblclick', resetView);
  const rb = $('#viewreset');
  if (rb) rb.addEventListener('click', resetView);
}
const F = {};          // 表情プリセットを足し込んだ、最終的なパラメータ
const smileSide = { R: 1, L: 1 };   // 笑いの目の、片目ずつの効き（台本で、ウインクの開けている方の目を細めないために使う。ふだんは 1）
const browSp = { x: null, v: 0 };   // まゆのはずみ（tune.browBounce）のばね
let idle = true;       // 呼吸などの自動の動きを入れるか
let showHair = q.get('hair') !== '0';   // 髪を描くか（既定は描く。?hair=0 で髪なし = 顔の確認用）
{ // 古い index.html がブラウザに残っているとチェックボックスが無いので、無くても止まらないようにする
  const box = $('#hair');
  if (box) { box.checked = showHair; box.addEventListener('change', (e) => { showHair = e.target.checked; }); }
}
let skipDraw = false;  // 確認用の早送り中は、計算だけして描かない

let frameT = 0;   // いま描いているフレームの時刻（ミリ秒）。毛束のそよぎに使う
function render(time, dt) {
  frameT = time;
  // --- 最終パラメータ ---
  for (const p of PARAMS) F[p.key] = cur[p.key];
  const lookDown = 1 - 0.05 * clamp((-cur.pitch / 25) * tune.downMax / 31, 0, 1);
  F.eyeR *= ex.eyeMul * ex.eyeMulR * lookDown; F.eyeL *= ex.eyeMul * ex.eyeMulL * lookDown;
  eyeRest = ex.eyeMul * lookDown;
  F.eyeSmile = clamp(F.eyeSmile + ex.eyeSmile, 0, 1);
  // まゆは、視線・まばたき・見開きについて動く（上を見ると上がり、まばたきで少し下がり、見開くと上がる）
  const eo = (cur.eyeR + cur.eyeL) / 2;
  // 目の開きについて動くぶん。tune.browBounce が 0 なら、そのまま（前と同じ）。0 より大きければ、ばねで追わせる（閉じると少し遅れて下がり、
  // 開くと行きすぎて上がってから戻る）。動きも少し大きくする
  const eyeLinkT = -0.2 * clamp(1 - eo, 0, 1) + 1.6 * Math.max(eo - 1, 0);
  let eyeLink = eyeLinkT;
  const bb = tune.browBounce;
  if (bb > 0) {
    const tg = eyeLinkT * (1 + 0.5 * Math.min(bb, 1));
    if (browSp.x === null) { browSp.x = tg; browSp.v = 0; }
    if (dt > 1e-5) {
      const om = TAU * 4.6, d = bb <= 1 ? lerp(1, 0.42, bb) : lerp(0.42, 0.28, bb - 1), nS = Math.max(1, Math.ceil(dt / 0.008)), hS = dt / nS;
      for (let i = 0; i < nS; i++) { browSp.v += (om * om * (tg - browSp.x) - 2 * d * om * browSp.v) * hS; browSp.x += browSp.v * hS; }
    }
    eyeLink = browSp.x;
  } else browSp.x = null;
  const browLink = tune.link * (0.22 * Math.max(-F.gazeY, 0) - 0.1 * Math.max(F.gazeY, 0) + eyeLink);
  F.browY = clamp(F.browY + ex.browY + browLink, -1.2, 1.2);
  F.browAngle = clamp(F.browAngle + ex.browAngle, -1.2, 1.2);
  F.browShow = clamp(F.browShow + ex.browShow, 0, 1);
  F.eyeTilt = clamp(F.eyeTilt + ex.eyeTilt, -1, 1); F.eyeJito = clamp(F.eyeJito + ex.eyeJito, 0, 1); F.eyeShut = clamp(F.eyeShut + ex.eyeShut, 0, 1);
  F.irisSize = clamp(F.irisSize + ex.irisSize, -1, 1); F.cheek = clamp(F.cheek + ex.cheek, 0, 1); F.browForm = clamp(F.browForm + ex.browForm, -1.2, 1.2);
  F.mouthOpen = clamp(F.mouthOpen + ex.mouthOpen * (micOn ? 0.3 : 1), 0, 1);
  F.mouthFormBase = F.mouthForm;   // 表情を足す前の口の形（口の幅・大きさ・位置は、こちらで決める）
  F.mouthForm = clamp(F.mouthForm + ex.mouthForm, -1.2, 1.2);   // 表情の切り替わりで、少しだけ行きすぎる
  F.mouthWidth = F.mouthWidth * ex.mouthWidth;
  F.mouthWave = clamp(F.mouthWave + ex.mouthWave, 0, 1);
  F.mouthTongue = clamp(F.mouthTongue + ex.mouthTongue, 0, 1);

  // --- 体と頭の姿勢 ---
  // 呼吸: 吸うのは速く、吐くのはゆっくり（tune.bodyMove。0 で前と同じ、同じ速さの行き来）
  const bm = tune.bodyMove * USER.body, bm1 = Math.min(bm, 1), bp = time * 0.0018;
  const breath = idle ? Math.sin(bp + 0.45 * bm1 * Math.sin(bp)) : 0;
  body.breath = (breath * 0.5 + 0.5) * (1 + 0.25 * bm1) * USER.body;
  body.sh = idle ? (breath * 0.5 + 0.5) * 3.2 * bm : 0;
  body.hb = idle ? Math.sin(bp - 0.5 * bm1 + 0.45 * bm1 * Math.sin(bp - 0.5 * bm1)) * USER.body : 0;   // 頭は、体より少し遅れて上下する
  // 体は、頭の動きに少し遅れてついてくる（ばね。少し行きすぎてから落ち着く）
  const swayT = F.bodyX * 46 + F.yaw * 0.55 + (idle ? Math.sin(time * 0.0007) * 4 * USER.body : 0), rollT = F.roll * DEG * 0.12 + F.bodyX * 0.02;
  const twT = Math.sin((F.yaw / 30) * tune.yawMax * DEG) * 0.1 * bm;
  if (body.sx === null || bm <= 0) { body.sx = swayT; body.rx = rollT; body.tw = twT; body.sv = body.rv = body.tv = 0; }
  else if (dt > 1e-5) {
    const om = TAU * 1.5, d = 0.62, nS = Math.max(1, Math.ceil(dt / 0.008)), hS = dt / nS;
    for (let i = 0; i < nS; i++) {
      body.sv += (om * om * (swayT - body.sx) - 2 * d * om * body.sv) * hS; body.sx += body.sv * hS;
      body.rv += (om * om * (rollT - body.rx) - 2 * d * om * body.rv) * hS; body.rx += body.rv * hS;
      body.tv += (om * om * (twT - body.tw) - 2 * d * om * body.tv) * hS; body.tw += body.tv * hS;
    }
  }
  body.sway = lerp(swayT, body.sx, bm1);
  body.roll = lerp(rollT, body.rx, bm1);
  const yaw = (F.yaw / 30) * tune.yawMax * DEG, pitch = (F.pitch / 25) * (F.pitch > 0 ? tune.upMax : tune.downMax) * DEG,
    roll = (F.roll / 25) * tune.rollMax * DEG + body.roll;
  pose.sinY = Math.sin(yaw); pose.cosY = Math.cos(yaw);
  pose.sinP = Math.sin(pitch); pose.cosP = Math.cos(pitch);
  tiltT = tune.headTilt * TILT_K * pose.sinP * pose.sinY;   // 斜めのときの、顔の中心線の傾き（surfMap・rotMap・makeGroup が使う）
  pose.sr = Math.sin(roll); pose.cr = Math.cos(roll);
  pose.down = clamp((-F.pitch / 25) * tune.downMax / 31, 0, 1);
  bodyT(PIV[0], PIV[1], tmp);
  pose.ox = tmp[0] - PIV[0];
  pose.oy = tmp[1] - PIV[1] + (idle ? body.hb * 1.5 : 0);

  stepSway(dt, time);
  if (skipDraw) return;
  // 下まぶたは、口角が上がる・口が大きく開くと、ほおに押されて少し上がる
  eyes.R.lift = eyes.L.lift = tune.link * (0.03 * clamp(F.mouthForm, 0, 1) + 0.022 * clamp(F.mouthOpen, 0, 1));
  eyes.R.update(F.eyeR, F.eyeSmile * smileSide.R, F.gazeX, F.gazeY);
  eyes.L.update(F.eyeL, F.eyeSmile * smileSide.L, F.gazeX, F.gazeY);
  brows.R.update(); brows.L.update(); nose.update(); pin.update(); cheeks[0].update(); cheeks[1].update();
  const o = [0, 0];
  for (const p of parts) {
    const m = p.mesh, r = m.rest, d = m.pos;
    for (let k = 0; k < m.n; k++) { p.deform(r[k * 2], r[k * 2 + 1], o); d[k * 2] = o[0]; d[k * 2 + 1] = o[1]; }
    uploadPos(m);
  }
  if (keyMouth) { mouth.group.update(); keyMouthStep(dt); keyMouth.update(); }   // キーの形の口（式の口は、作らない）
  else mouth.update();

  // --- マスク（顔=R、右の白目=G、左の白目=B、口の中=A）---
  const aspect = view.width / view.height;
  gl.viewport(0, 0, view.width, view.height);
  gl.uniform4f(U.uView, VIEW.cx, VIEW.cy, 1 / (VIEW.half * aspect), 1 / VIEW.half);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, maskFbo);
  gl.colorMask(true, true, true, true);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1i(U.uMode, 2);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.blendEquation(gl.MAX);
  gl.colorMask(true, false, false, false); drawRaw(pFace.mesh, pFace.tex, 1);
  gl.colorMask(false, true, false, false); drawRaw(pWhiteR.mesh, pWhiteR.tex, pWhiteR.alpha());
  gl.colorMask(false, false, true, false); drawRaw(pWhiteL.mesh, pWhiteL.tex, pWhiteL.alpha());
  gl.colorMask(false, false, false, true); if (!keyMouth) mouth.drawMask();
  gl.colorMask(true, true, true, true);
  gl.blendEquation(gl.FUNC_ADD);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex);

  // --- 本描画 ---
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const d of draws) {
    if (d.mouth) { setBlend(false); if (keyMouth) makeLayer(keyMouth.draw, FACE, NONE); else mouth.draw(); continue; }
    if (d.keyEye) {   // キーの形の目: 下まつげ・二重の線を重ねてから、まつげ（キーの絵を重みで足した 1 枚）を重ねる
      const ke = eyes[d.keyEye].ke, free = tune.lash > 0 ? NONE : FACE;
      if (d.over) { if (showHair) makeLayer(() => ke.drawLash(0), free, NONE, d.over); continue; }
      // model.json の eyeLineClip: 下まつげ・目尻の線・二重の線（肌の上の線）は、顔の輪郭の内側だけに描く（書かなければ、まつげと同じ = 前と同じ）。
      // tune.lash で、上まつげを輪郭の外へ出すモデルでは、奥の目が輪郭をまたぐと、下まぶたの赤い線だけが、輪郭の外の髪の上に浮いて見える
      setBlend(false); setMask(model.eyeLineClip ? FACE : free, NONE); ke.drawUnder();
      if (Array.isArray(model.lidShadow)) makeLayer(() => ke.drawLash(model.lidShadow[0]), d.keyEye === 'R' ? EYE_R : EYE_L, FACE, model.lidShadow[1]);   // 上まぶたの影（白目と瞳の上だけ）
      makeLayer(() => ke.drawLash(0), free, NONE);
      continue;
    }
    const p = d.p, L = p.L;
    if (!showHair && /^(結び髪|後ろ髪|頭\/前髪|頭\/帽子|頭\/ピン留め|頭\/顔\/輪郭\/前髪影)/.test(L.path)) continue;
    const a = (d.alpha ? d.alpha() : p.alpha() * (L.hidden && !p.diff ? 0 : 1)) * L.opacity;
    if (a <= 0.003) continue;
    setBlend(L.blend === 'multiply');
    setMask(p.lashFree && tune.lash > 0 ? NONE : p.sel1, p.sel2);   // まつげは、顔の輪郭の外へ出てよい（白目と瞳は、顔の中だけ）
    if (d.tint) gl.uniform3fv(U.uTint, d.tint);
    drawRaw(p.mesh, p.tex, a);
    if (d.tint) gl.uniform3f(U.uTint, 1, 1, 1);
  }
}

// ---- 入力: マウス / デモ / Webカメラ / マイク / 自動まばたき ----------------
const mouse = { x: 0, y: 0 };
let previewT0 = -1;   // 「ためしに動かす」を始めた時刻（秒。-1 = していない）
// ためしに動かす: 手で止めているときは、前の動かし方へ戻してから。マウスのときだけ動く（カメラ・おまかせでは、もう動いている）
function previewMotion() { if (mode === 'manual') setMode(lastLive); if (mode === 'mouse') previewT0 = performance.now() / 1000; }
addEventListener('pointermove', (e) => {
  mouse.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
  mouse.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
});

// 自動まばたき。閉じるのは加速しながら速く、開くのは減速しながら少しゆっくり。開いた直後に一瞬だけ見開く。
// 種類は 3 つ（ふつう・二度・長め）で、時間は毎回少し変える（時間と割合は PuruPuruPNGTuber の blinkEventSteps に合わせた）
const rnd = (a, b) => a + Math.random() * (b - a);
const blink = { next: 1200, steps: null, i: 0, t0: 0 };
function blinkSteps() {
  const r = Math.random();   // [閉じる, 閉じたまま, 開く, 次までの間] ms
  if (r < 0.18) return [[rnd(62, 86), rnd(32, 56), rnd(108, 146), rnd(86, 142)], [rnd(58, 82), rnd(30, 52), rnd(118, 158), 0]];
  if (r < 0.27) return [[rnd(72, 98), rnd(120, 210), rnd(150, 210), 0]];
  return [[rnd(62, 90), rnd(32, 66), rnd(122, 178), 0]];
}
const BLINK_ANT = 18, BLINK_POP = 95;   // 閉じる前の小さな見開き、開いた直後の見開き（ms）
function autoBlink(time) {
  if (!blink.steps) {
    if (time < blink.next) return 1;
    blink.steps = blinkSteps(); blink.i = 0; blink.t0 = time;
  }
  const s = blink.steps[blink.i], last = blink.i === blink.steps.length - 1;
  let t = time - blink.t0;
  if (t < s[0]) {
    if (t < BLINK_ANT) return 1 + 0.05 * Math.sin(Math.PI * t / BLINK_ANT);
    const u = (t - BLINK_ANT) / Math.max(1, s[0] - BLINK_ANT);
    return 1 - u * u * u;
  }
  t -= s[0];
  if (t < s[1]) return 0;
  t -= s[1];
  if (t < s[2]) return (1 - Math.pow(1 - t / s[2], 3)) * 1.04;
  t -= s[2];
  const tail = last ? BLINK_POP : s[3];
  if (t < tail) return 1 + 0.04 * (1 - smoother(clamp(t / BLINK_POP, 0, 1)));
  if (last) { blink.steps = null; blink.next = time + (Math.random() < 0.2 ? rnd(850, 1500) : rnd(1900, 4600)); return 1; }
  blink.i++; blink.t0 = time;
  return 1;
}
// ときどき視線を小さく動かす
const saccade = { next: 2000, x: 0, y: 0 };
function autoGaze(time) {
  if (time > saccade.next) {
    saccade.x = (Math.random() - 0.5) * 0.35; saccade.y = (Math.random() - 0.5) * 0.2;
    saccade.next = time + rnd(1200, 4000);
  }
}
// 視線は、ばねで追う（少し行きすぎてから戻る）。f 速さ(Hz)、d 止まりやすさ、r 目標の動きへの先回り
const GAZE_SPRING = { gazeX: { f: 6.2, d: 0.82, r: 0.2, v: 0, pt: null }, gazeY: { f: 5.8, d: 0.84, r: 0.16, v: 0, pt: null } };
function gazeStep(g, key, dt) {
  const tg = target[key];
  if (g.pt === null) g.pt = tg;
  const b = eyeTune.gazeBounce * USER.puru, d = b <= 1 ? lerp(1, g.d, b) : lerp(g.d, 0.5, b - 1), r = g.r * Math.min(b, 1);
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n, tv = (tg - g.pt) / dt, om = TAU * g.f;
  for (let i = 0; i < n; i++) {
    g.v += (om * om * (tg - cur[key]) + 2 * d * om * (r * tv - g.v)) * h;
    cur[key] += g.v * h;
  }
  cur[key] = clamp(cur[key], -1.2, 1.2);
  g.pt = tg;
}

// Webカメラ（MediaPipe Face Landmarker）。同梱の vendor/mediapipe/ から、押したときに 1 回だけ読み込む（ネットは使わない。
// 版を替えるときは、vendor/mediapipe/ の中身と SHASUMS256.txt、THIRD_PARTY_NOTICES.md も替える）
const MP_VER = '0.10.14';
const MP_DIR = new URL(`../vendor/mediapipe/tasks-vision/${MP_VER}/`, import.meta.url).href.replace(/\?.*$/, '');
const MP_MODEL = new URL('../vendor/mediapipe/face_landmarker/float16/1/face_landmarker.task', import.meta.url).href.replace(/\?.*$/, '');
let landmarker = null, camReady = false, camStarting = false, lastVideoTime = -1;
async function startCamera() {
  if (camReady) { status('カメラで追従中'); return; }
  status('カメラとモデルを準備中…');
  // 準備の最中に、もう 1 回呼ばれても、2 重に始めない。2 重に始めると、先の再生が打ち切られて（AbortError）、
  // 動かし方がマウスへ戻るのに、あとの準備が終わって「カメラで追従中」と出る（URL の mode=camera で起きた。起動時に setMode が 2 回呼ばれる）
  if (camStarting) return;
  camStarting = true;
  try {
    const cam = $('#cam');
    cam.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    await cam.play();
    const mp = await import(MP_DIR + 'vision_bundle.mjs');
    const files = await mp.FilesetResolver.forVisionTasks(MP_DIR + 'wasm');
    landmarker = await mp.FaceLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: MP_MODEL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    camReady = true;
    // 準備の間に、ほかの動かし方へ切り替えられていたら、小窓と表示は出さない（次に Web カメラを押したとき、すぐ始まる）
    if (mode === 'camera') { cam.style.display = 'block'; status('カメラで追従中'); }
  } catch (err) {
    console.error(err);
    if (mode === 'camera') setMode('mouse');
    status('カメラを開始できませんでした: ' + err.message);
  } finally {
    camStarting = false;
  }
}
function trackCamera(time) {
  const cam = $('#cam');
  if (!camReady || cam.currentTime === lastVideoTime) return;
  lastVideoTime = cam.currentTime;
  const res = landmarker.detectForVideo(cam, time);
  if (!res.faceBlendshapes || !res.faceBlendshapes.length) return;
  const b = {};
  for (const c of res.faceBlendshapes[0].categories) b[c.categoryName] = c.score;
  const m = res.facialTransformationMatrixes[0].data; // 列優先の 4x4
  // TODO: 要確認 - 回転の符号は実機のカメラで未検証。向きが逆なら「鏡写し」を切り替えるか、ここの符号を直す
  const s = mirror ? 1 : -1;
  target.yaw = clamp((Math.atan2(m[8], m[10]) / DEG) * -s, -30, 30);
  target.pitch = clamp((Math.asin(clamp(-m[9], -1, 1)) / DEG) * -1, -25, 25);
  target.roll = clamp((Math.atan2(m[1], m[5]) / DEG) * -s, -25, 25);
  target.bodyX = clamp(target.yaw / 60, -1, 1);
  const eye = (v) => 1 - clamp((v - 0.12) / 0.45, 0, 1);
  const smile = ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2;
  const A = mirror ? 'Left' : 'Right', B = mirror ? 'Right' : 'Left';
  target.eyeR = eye(b['eyeBlink' + A] || 0);   // 画面左に映る目
  target.eyeL = eye(b['eyeBlink' + B] || 0);
  target.eyeSmile = clamp((smile - 0.35) / 0.4, 0, 1);
  target.gazeX = clamp((((b.eyeLookInLeft || 0) - (b.eyeLookOutLeft || 0)) + ((b.eyeLookOutRight || 0) - (b.eyeLookInRight || 0))) * 0.8 * s, -1, 1);
  target.gazeY = clamp((((b.eyeLookDownLeft || 0) + (b.eyeLookDownRight || 0)) - ((b.eyeLookUpLeft || 0) + (b.eyeLookUpRight || 0))) * 0.7, -1, 1);
  target.browY = clamp((b.browInnerUp || 0) * 1.4 - ((b.browDownLeft || 0) + (b.browDownRight || 0)) * 0.8, -1, 1);
  target.browAngle = clamp(((b.browDownLeft || 0) + (b.browDownRight || 0)) * 0.9 - (b.browInnerUp || 0) * 0.8, -1, 1);
  if (!micOn) target.mouthOpen = clamp((b.jawOpen || 0) * 1.6, 0, 1);
  target.mouthForm = clamp(smile * 1.3 - ((b.mouthFrownLeft || 0) + (b.mouthFrownRight || 0)) * 0.7, -1, 1);
  target.mouthWidth = clamp(1 - (b.mouthPucker || 0) * 0.6 + smile * 0.15, 0.4, 1.3);
}

// マイクの音量で口を開ける
let micOn = false, analyser = null, micBuf = null;
// ---- 口パク（マイクの音 → 母音 → 口の形）------------------------------------
// js/lipsync.js が、マイクの音から「あ・い・う・え・お」の重みと声の大きさを出す。
// ここでは、それを口の形（開き・幅・すぼめ・歯）に直す。口角の上がり下がり（mouthForm）は表情の側が持つので、
// 同じ「あ」でも、笑顔なら弓なりに、怒りなら山形になる
const LS = await import('./lipsync.js?v=' + JS_V);
const lipSet = LS.loadSettings();
let lip = null;
//                 開き  幅    すぼめ 歯
// 母音ごとの口の形。初期値は model.json の mouthShapes（キャラの設定）。操作パネルの「母音の口の大きさ」で変えられ、ブラウザに保存する
const SHAPE_KEYS = [
  { key: 'open', label: '開き（高さ）', min: 0, max: 1, to: 'mouthOpen' },
  { key: 'width', label: '幅', min: 0.4, max: 1.3, to: 'mouthWidth' },
  { key: 'y', label: '上下の位置', min: -1, max: 1, to: 'mouthY' },
  { key: 'lift', label: '開く向き（上へ）', min: 0, max: 1, to: 'mouthLift' },
  { key: 'round', label: '丸さ（すぼめ）', min: 0, max: 1, to: 'mouthRound' },
  { key: 'top', label: '上の線の反り', min: -1, max: 1, to: 'mouthTop' },
  { key: 'point', label: '下のとがり', min: 0, max: 1, to: 'mouthPoint' },
  { key: 'teeth', label: '歯を見せる', min: 0, max: 1, to: 'mouthTeeth' },
];
const SHAPE_DEF = {
  a: { open: 0.85, width: 1.05, y: 0, lift: 0.15, round: 0, top: 0, point: 0, teeth: 0 },
  i: { open: 0.3, width: 1.2, y: 0, lift: 0.3, round: 0, top: 0, point: 0, teeth: 1 },
  u: { open: 0.32, width: 0.5, y: 0, lift: 0.3, round: 1, top: 0, point: 0, teeth: 0 },
  e: { open: 0.4, width: 1.2, y: 0, lift: 0.2, round: 0, top: 0, point: 0, teeth: 0 },
  o: { open: 0.75, width: 0.62, y: 0, lift: 0.2, round: 1, top: 0, point: 0, teeth: 0 },
};
const VOWEL_SHAPE = {}, SHAPE_KEY = MODEL_NAME + '.mouthShapes.v1';
for (const v of LS.VOWELS) VOWEL_SHAPE[v] = Object.assign({}, SHAPE_DEF[v], (model.mouthShapes || {})[v] || {});
const SHAPE_INIT = JSON.parse(JSON.stringify(VOWEL_SHAPE));
try { const sv = JSON.parse(localStorage.getItem(SHAPE_KEY) || '{}'); for (const v of LS.VOWELS) for (const k of SHAPE_KEYS) if (typeof (sv[v] || {})[k.key] === 'number') VOWEL_SHAPE[v][k.key] = clamp(sv[v][k.key], k.min, k.max); } catch (e) { /* 保存が使えない環境では初期値 */ }
// キーの形の口（描かせた絵を切り替える口）の、母音ごとの形の足し。上の VOWEL_SHAPE はベクターの口の値で、キーの形の口には効かない
// （開き・幅を動かしても、形が変わらなかった）。絵の線を、閉じた口のまん中の線から縦に伸び縮み・横に伸び縮み・上下にずらす。
// 初期値は model.json の keyMouthShapes（char.json の同じ名前）。書かなければ、倍率 1・ずれ 0 = 前と同じ形
const KM_SHAPE_KEYS = [
  { key: 'open', label: '開き（倍率）', min: 0.4, max: 1.6 },
  { key: 'width', label: '幅（倍率）', min: 0.6, max: 1.4 },
  { key: 'y', label: '上下の位置', min: -1, max: 1 },
];
const KM_SHAPE = {}, KM_SHAPE_KEY = MODEL_NAME + '.keyMouthShapes.v1';
for (const v of LS.VOWELS) KM_SHAPE[v] = Object.assign({ open: 1, width: 1, y: 0 }, (model.keyMouthShapes || {})[v] || {});
const KM_SHAPE_INIT = JSON.parse(JSON.stringify(KM_SHAPE));
try { const sv = JSON.parse(localStorage.getItem(KM_SHAPE_KEY) || '{}'); for (const v of LS.VOWELS) for (const k of KM_SHAPE_KEYS) if (typeof (sv[v] || {})[k.key] === 'number') KM_SHAPE[v][k.key] = clamp(sv[v][k.key], k.min, k.max); } catch (e) { /* 保存が使えない環境では初期値 */ }
for (const v of LS.VOWELS) {   // URL の set=（OBS 用の URL）
  const sv = (URLSET.vowels || {})[v] || {}, T = keyMouth ? KM_SHAPE : VOWEL_SHAPE;
  for (const k of (keyMouth ? KM_SHAPE_KEYS : SHAPE_KEYS)) if (typeof sv[k.key] === 'number' && isFinite(sv[k.key])) T[v][k.key] = clamp(sv[k.key], k.min, k.max);
}
if (keyMouth) keyMouth.shapeMod = KM_SHAPE;
const P_OF = {}; for (const pr of PARAMS) P_OF[pr.key] = pr;
const P_WIDTH = P_OF.mouthWidth;
const lipNow = { vol: 0, top: '' };       // 画面の表示用
// w: 母音の重み、vol: 声の大きさ 0〜1、voiced: 声（母音）らしさ 0〜1。loud を渡すと、声の大きさによらずその開きにする（形の確認用）
function applyVowels(w, vol, voiced, loud) {
  kmVow.a = w.a || 0; kmVow.i = w.i || 0; kmVow.u = w.u || 0; kmVow.e = w.e || 0; kmVow.o = w.o || 0;   // キーの形の口（keyMouth）用
  kmVow.vol = loud !== undefined ? loud : Math.pow(Math.max(vol, 0), 0.55) * lerp(0.55, 1, voiced);
  let sum = 0, top = '', tv = 0;
  const acc = {}; for (const k of SHAPE_KEYS) acc[k.key] = 0;
  for (const v of LS.VOWELS) { const kw = w[v]; sum += kw; for (const k of SHAPE_KEYS) acc[k.key] += kw * VOWEL_SHAPE[v][k.key]; if (kw > tv) { tv = kw; top = v; } }
  const talk = loud !== undefined ? 1 : sstep(0.02, 0.22, vol);
  if (sum < 1e-3) { sum = 1; for (const k of SHAPE_KEYS) acc[k.key] = k.key === 'open' ? 0.6 : P_OF[k.to].def; }
  for (const k of SHAPE_KEYS) {
    const val = acc[k.key] / sum;
    if (k.key === 'open') target.mouthOpen = clamp(val * (loud !== undefined ? loud : Math.pow(vol, 0.55) * 1.15 * lerp(0.55, 1, voiced)), 0, 1);   // 息だけの音（さ行など）は小さく開く
    else target[k.to] = lerp(P_OF[k.to].def, val, talk);
  }
  lipNow.vol = vol; lipNow.top = talk > 0.3 ? top : '';
}
function restMouth() { kmVow.vol = 0; target.mouthOpen = 0; for (const k of SHAPE_KEYS) if (k.key !== 'open') target[k.to] = P_OF[k.to].def; }
let shapeEdit = q.get('vowel') || '';      // 形を調整中の母音（その形のまま止める）。URL の vowel=a などでも指定できる
async function startMic() {
  try {
    lip = await LS.startLipSync(lipSet);
    micOn = true;
  } catch (err) {
    status('マイクを開始できませんでした: ' + err.message);
    $('#mic').checked = false;
  }
}
function stopMic() {
  micOn = false;
  if (lip) { lip.stop(); lip = null; }
  restMouth();
  lipNow.vol = 0; lipNow.top = '';
}
function trackMic() {
  const r = lip.read();
  applyVowels(r.w, r.vol, r.voiced);
}
// 口パクデモ: 音は出さず、せりふ（ひらがな）の母音どおりに口を動かす。操作パネルのボタン、または ?talkdemo=1
//   1 文字（1 拍）ごとに母音の形にし、拍の間は少しだけ閉じる。ま行・ば行・ぱ行は、いったん唇を閉じる。
//   「ん」は小さく開いたまま、「っ」と「、」「。」は閉じて間を取る。「ー」は前の母音をのばす
const TALK_TEXT = model.talkDemo || 'こんにちは、くらげちゃんです。きょうも いちにち、よろしくおねがいします。えへへ、うまく しゃべれてるかな。みてくれて、ありがとー。';
const KANA_V = { a: 'あかさたなはまやらわがざだばぱゃぁ', i: 'いきしちにひみりぎじぢびぴぃ', u: 'うくすつぬふむゆるぐずづぶぷゅぅ', e: 'えけせてねへめれげぜでべぺぇ', o: 'おこそとのほもよろをごぞどぼぽょぉ' };
const KANA_CLOSE = 'まみむめもばびぶべぼぱぴぷぺぽ';
function buildLine(TEXT) {
  const T = [], acc = [0]; let t = 0, prev = 'a', n = 0;   // acc: 句の頭の時刻（頭の小さなうなずきに使う）
  for (const ch of TEXT) {
    n++;
    const rnd = (k) => { const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };   // 決まった乱れ（毎回同じ動き）
    let v = null;
    for (const k in KANA_V) if (KANA_V[k].includes(ch)) v = k;
    if (v) { const d = 0.125 + 0.035 * rnd(1); T.push({ t0: t, t1: t + d, v, vol: 0.62 + 0.38 * rnd(2), close: KANA_CLOSE.includes(ch) }); t += d; prev = v; }
    else if (ch === 'ー' || ch === '〜') { T.push({ t0: t, t1: t + 0.2, v: prev, vol: 0.7, long: true }); t += 0.2; }
    else if (ch === 'ん') { T.push({ t0: t, t1: t + 0.12, v: 'u', vol: 0.12, long: true }); t += 0.12; }
    else if (ch === 'っ') t += 0.09;
    else if (ch === '、' || ch === ' ' || ch === '　') { t += ch === '、' ? 0.28 : 0.1; acc.push(t); }
    else if (ch === '…') t += 0.3;
    else if (ch === '！' || ch === '？') t += 0.2;
    else if (ch === '。') t += 0.75;
  }
  return { T, len: t + 0.4, end: T.length ? T[T.length - 1].t1 : t, acc };
}
const talkLine = buildLine(TALK_TEXT);
let talkDemo = q.has('talkdemo') ? 0 : -1;
function trackTalkDemo(time) {
  const t = (time / 1000 - talkDemo) % talkLine.len;
  const m = talkLine.T.find((x) => t >= x.t0 && t < x.t1);
  if (!m) { applyVowels(oneHot, 0, 1); return; }
  for (const v of LS.VOWELS) oneHot[v] = v === m.v ? 1 : 0;
  const x = (t - m.t0) / (m.t1 - m.t0);
  let e = m.long ? 1 : 0.55 + 0.45 * Math.sin(Math.PI * x);        // 拍の間は少しだけ閉じる
  if (m.close) e *= sstep(0.15, 0.5, x);                           // ま行・ば行・ぱ行は、いったん閉じてから開く
  applyVowels(oneHot, m.vol * e, 1);
}
// 確認用: マイクなしで「あ・い・う・え・お」を順に言わせる（?lipdemo=1、または操作パネルの「あいうえお と言わせる」）
let lipDemo = q.has('lipdemo') ? 0 : -1;
const oneHot = { a: 0, i: 0, u: 0, e: 0, o: 0 };
function trackLipDemo(time) {
  const T = 0.5, t = (time / 1000 - lipDemo) / T, k = Math.floor(t);
  if (k >= 10) { lipDemo = q.has('lipdemo') ? time / 1000 : -1; applyVowels(oneHot, 0, 1); return; }
  for (const v of LS.VOWELS) oneHot[v] = 0;
  oneHot[LS.VOWELS[k % 5]] = 1;
  applyVowels(oneHot, Math.pow(Math.sin(Math.PI * clamp((t - k) / 0.85, 0, 1)), 0.6), 1);
}

// ---- デモ（ひとり芝居）------------------------------------------------------
// 人が話しているときの動きを、決まった台本（ACT）と、いつも掛かっている小さな動きの重ね合わせで作る。
//   ・目が先、頭があと: 見る先（look）が変わると、まず視線が飛び、頭は 0.1 秒ほど遅れて、ゆっくり追いかける。
//     頭が追いつくにつれて、目は顔の正面へ戻る（視線は、見る先に止まったまま）
//   ・頭の動きは、動き出しが速く、止まりぎわがゆっくり（mj）。まっすぐでなく、少し沈む弧を通る。横を向くと、少しかしげる
//   ・大きく視線を動かすときは、まばたきをはさむ
//   ・話すときは、声の強さに合わせて頭が小さく動き、句の頭で小さくうなずく
//   ・止まっているときも、ゆっくりした ゆらぎ が掛かっている（同じ周期のくり返しに見えないよう、周期の違う波を重ねる）
// 台本の 1 行: d 前の行からの秒 / a 前のせりふが終わってからの秒
//   look [x, y] 見る先（-1〜1。x 右が +、y 上が +）、follow 頭がどれだけそちらを向くか、head [x, y] 頭の向きを直接指定（上目づかい・横目）
//   dur 頭の動きにかける秒、lag 目から頭までの遅れ、tilt かしげ(°)、lean 体の左右
//   sink 頭と体を沈める(px。居眠り)
//   expr 表情、smile 目を開けたままのほほえみ、eye 目の開き、eyeRate その速さ、wink 片目を閉じる、blink 1 まばたきを入れる / 0 入れない
//   say せりふ（ひらがな。口が母音どおりに動く。画面の下にも出す）
//   nod うなずき・shake 首を横に振る { n 回数, amp 大きさ(°), per 1 回の秒 }、hop 小さくはねる、laugh 笑って体がゆれる(秒)、spin 目が回る(秒)
// ダイジェスト版デモ台本（約 14 秒で 1 周。振り向き・かしげの揺れ、口パク、主要表情をテンポよく見せる）
const ACT = [
  // 1. 気づく → あいさつ（にこ＋うなずき）
  { d: 0, look: [0.45, -0.1], follow: 0.5, dur: 0.01, lag: 0, expr: '通常', eye: 1, smile: 0, tilt: 3, wink: 0, lean: 0, sink: 0, blink: 0 },
  { d: 0.45, look: [0, 0], follow: 0.95, dur: 0.38, expr: 'にこ', say: 'こんにちはー！', nod: { n: 1, amp: 14, per: 0.45 }, tilt: 6 },
  // 2. 左右に振って髪・傘の揺れを見せる → キラキラ
  { a: 0.15, expr: '通常', smile: 0.4, look: [0.85, 0.08], follow: 0.95, dur: 0.42, tilt: -8 },
  { d: 0.95, look: [-0.85, 0.05], follow: 0.95, dur: 0.46, tilt: 9 },
  { d: 1.05, look: [0, 0.05], follow: 0.95, dur: 0.36, expr: 'キラキラ', eye: 1.08, hop: 0.85, tilt: -3, smile: 0.3, say: 'みてみて！' },
  // 3. 照れ → てへ（片目ウインク）
  { a: 0.2, expr: '照れ', eye: 1, look: [-0.45, -0.3], follow: 0.6, dur: 0.42, tilt: -9, smile: 0.2, say: 'えへへ…' },
  { a: 0.15, expr: 'てへ', wink: 1, look: [0, 0], head: [-0.1, -0.04], dur: 0.35, tilt: 10 },
  // 4. びっくり（青ざめ）→ すねる（怒り）
  { d: 1.25, expr: '青ざめ', wink: 0, look: [-0.85, 0.1], follow: 0.8, dur: 0.28, lag: 0.08, eye: 1.12, hop: 0.6, tilt: -4, say: 'わっ！', blink: 0 },
  { a: 0.25, expr: '怒り', eye: 1, look: [0.75, 0.12], follow: 0.85, dur: 0.38, tilt: 7, say: 'もー！' },
  // 5. 笑顔 → ハート → ω
  { a: 0.25, expr: '笑顔', look: [0, 0.04], head: [0.05, 0.06], dur: 0.36, tilt: -5, laugh: 1.1, say: 'あはは！' },
  { a: 0.2, expr: 'ハート', look: [0, 0], head: [0, -0.06], dur: 0.42, tilt: 8, smile: 0.3 },
  { d: 1.2, expr: 'ω', head: [0, 0.03], dur: 0.35, tilt: -6, nod: { n: 1, amp: 10, per: 0.38 } },
  // 6. ぐるぐる → 首振り → おわりのあいさつ（にこ）
  { d: 1.15, expr: 'ぐるぐる', tilt: 0, spin: 1.6 },
  { d: 1.65, expr: '閉じ目', shake: { n: 2, amp: 12, per: 0.24 } },
  { d: 0.6, expr: 'にこ', eye: 1, look: [0, 0], head: [0, 0], dur: 0.38, tilt: 6, say: 'またねー！', nod: { n: 1, amp: 13, per: 0.42 } },
  { a: 0.35, expr: '通常', smile: 0.3, tilt: 0 },
  { d: 0.65 },
];
{ // 台本の各行の時刻を決める
  let t = 0, sayEnd = 0;
  for (const c of ACT) {
    t = 'a' in c ? Math.max(t, sayEnd) + c.a : t + (c.d || 0);
    c.t = t;
    if (c.say) { c.line = buildLine(c.say); sayEnd = t + c.line.end; }
  }
}
const ACT_LEN = ACT[ACT.length - 1].t;
const act = { t0: null, i: 0, last: 0, L: [0, 0], hF: [0, 0], hT: [0, 0], hT0: 0, hDur: 0.5, amp: 0, follow: 0.6,
  tilt: 0, tiltNow: 0, lean: 0, leanNow: 0, smile: 0, smileNow: 0, eye: 1, eyeNow: 1, eyeRate: 9, wink: 0, winkNow: 0, sink: 0, sinkNow: 0,
  line: null, lineT0: 0, env: 0, g: {}, eyeR: 1, eyeL: 1, on: false };
const mj = (x) => { x = Math.pow(clamp(x, 0, 1), 0.82); return x * x * x * (10 - 15 * x + 6 * x * x); };   // 動き出しが速く、止まりぎわがゆっくり
const wob = (t, s) => 0.5 * Math.sin(t * 0.61 + s) + 0.3 * Math.sin(t * 1.37 + s * 2.1) + 0.2 * Math.sin(t * 2.9 + s * 3.3);   // ゆらぎ（-1〜1）
const actHead = (t, o) => { const k = mj((t - act.hT0) / act.hDur); o[0] = lerp(act.hF[0], act.hT[0], k); o[1] = lerp(act.hF[1], act.hT[1], k); return o; };
const hv = [0, 0];
function actReset(ts) {
  Object.assign(act, { t0: ts, i: 0, last: 0, line: null, env: 0, g: {}, hT0: -9, hDur: 0.01 });
  act.hF = [0, 0]; act.hT = [0, 0]; act.L = [0, 0];
}
function actStop() {   // デモをやめたとき、デモが動かしていた値を元へ戻す
  act.on = false; act.t0 = null; act.eyeR = act.eyeL = 1; body.act = 0;
  for (const k of ['mouthForm', 'browY', 'browAngle']) target[k] = P_OF[k].def;
  if (!micOn) restMouth();
}
function actFire(c) {
  const tc = c.t;
  if (c.look || c.head || 'follow' in c) {
    actHead(tc, hv); act.hF = [hv[0], hv[1]];
    const oL = act.L;
    if (c.look) act.L = c.look;
    if ('follow' in c) act.follow = c.follow;
    act.hT = c.head ? c.head : [act.L[0] * act.follow, act.L[1] * act.follow];
    act.amp = Math.hypot(act.hT[0] - act.hF[0], act.hT[1] - act.hF[1]);
    act.hT0 = tc + (c.lag ?? 0.1);
    act.hDur = c.dur ?? clamp(0.42 + 0.5 * act.amp, 0.42, 1.0);
    // 大きく視線を動かすときは、まばたきをはさむ
    if (c.blink !== 0 && Math.hypot(act.L[0] - oL[0], act.L[1] - oL[1]) > 0.45 && !blink.steps) blink.next = nowT + 20;
  }
  if (c.blink === 1 && !blink.steps) blink.next = nowT;
  if (c.expr) setExpr(c.expr);
  for (const k of ['tilt', 'lean', 'smile', 'eye', 'wink', 'sink']) if (k in c) act[k] = c[k];
  act.eyeRate = c.eyeRate || 9;
  if (c.line) { act.line = c.line; act.lineT0 = tc; status(c.say); }
  for (const k of ['nod', 'shake', 'hop', 'laugh', 'spin']) if (c[k]) act.g[k] = { t0: tc, v: c[k] };
}
function runDemo(time) {
  const ts = time / 1000;
  if (act.t0 === null) actReset(ts);
  let t = ts - act.t0;
  if (t >= ACT_LEN) { actReset(ts); t = 0; }
  act.on = true;
  while (act.i < ACT.length && ACT[act.i].t <= t) actFire(ACT[act.i++]);
  const dt = clamp(t - act.last, 0, 0.1); act.last = t;
  const ease = (k, r) => { act[k + 'Now'] += (act[k] - act[k + 'Now']) * (1 - Math.exp(-dt * r)); };
  ease('tilt', 5); ease('lean', 3); ease('smile', 6); ease('eye', act.eyeRate); ease('wink', 16); ease('sink', 2.5);
  // --- 頭: 見る先へ、遅れて、弧を通って向く
  actHead(t, hv);
  const pr = clamp((t - act.hT0) / act.hDur, 0, 1);
  let yaw = 28 * hv[0], pitch = 25 * hv[1] - 4 * Math.sin(Math.PI * pr) * Math.min(1, act.amp * 1.6);   // 上下は、値いっぱいでも上限の角度が小さいので、大きめに取る
  let roll = act.tiltNow - 0.22 * yaw, by = -act.sinkNow, gx = 0, gy = 0;
  // --- いつも掛かっている、ゆっくりした ゆらぎ
  yaw += 1.5 * wob(t, 1) + 1.2 * wob(t * 0.23, 5); pitch += 2.4 * wob(t, 2.7) + 1.6 * wob(t * 0.2, 9); roll += 1.3 * wob(t * 0.8, 4.1) + 0.8 * wob(t * 0.17, 7);
  // --- せりふ: 口と、声に合わせた頭の動き
  let envT = 0, brow = 0;
  if (!micOn && !shapeEdit) {   // 母音の形を調整中（母音を選んでいる間）は、せりふの口で上書きしない（前は、選んだ母音がすぐ消え、スライダーが効かなかった）
    const L = act.line, lt = t - act.lineT0, m = L && L.T.find((x) => lt >= x.t0 && lt < x.t1);
    if (m) {
      for (const v of LS.VOWELS) oneHot[v] = v === m.v ? 1 : 0;
      const x = (lt - m.t0) / (m.t1 - m.t0);
      let e = m.long ? 1 : 0.55 + 0.45 * Math.sin(Math.PI * x);
      if (m.close) e *= sstep(0.15, 0.5, x);
      applyVowels(oneHot, m.vol * e, 1); envT = m.vol * e;
    } else { applyVowels(oneHot, 0, 1); if (L && lt > L.end + 0.5) { act.line = null; status(''); } }
    if (L) for (const a0 of L.acc) { const x = (lt - a0) / 0.34; if (x > 0 && x < 1) { const k = Math.sin(Math.PI * x) ** 2; pitch -= 6 * k; by -= 1.5 * k; brow += 0.35 * k; } }
  }
  act.env += (envT - act.env) * (1 - Math.exp(-dt * 12));
  pitch -= 4 * act.env; yaw += 0.7 * act.env * Math.sin(t * 5.1);
  // --- しぐさ
  const G = act.g;
  if (G.nod) { const g = G.nod.v, x = (t - G.nod.t0) / g.per; if (x < g.n) { const k = (0.5 - 0.5 * Math.cos(TAU * x)) * Math.pow(0.7, Math.floor(x)); pitch -= g.amp * k; by -= 0.3 * g.amp * k; } }
  if (G.shake) { const g = G.shake.v, x = (t - G.shake.t0) / g.per; if (x < g.n) yaw += g.amp * Math.sin(TAU * x) * (1 - x / g.n); }
  if (G.hop) { const x = (t - G.hop.t0) / 0.3, a = G.hop.v; if (x < 1) { by += 16 * a * Math.sin(Math.PI * x); pitch += 8 * a * Math.sin(Math.PI * x); } else if (x < 1.7) by += 5 * a * Math.sin(Math.PI * (x - 1) / 0.7); }
  if (G.laugh) { const d = G.laugh.v, x = (t - G.laugh.t0) / d; if (x < 1) { const e = sstep(0, 0.12, x) * (1 - sstep(0.6, 1, x)), w = Math.sin(TAU * 4.4 * (t - G.laugh.t0)); by += 6 * e * Math.abs(w); pitch += e * (10 + 4 * w); roll += 1.5 * e * Math.sin(TAU * 1.1 * (t - G.laugh.t0)); } }
  if (G.spin) { const d = G.spin.v, u = t - G.spin.t0; if (u < d) { const e = sstep(0, 0.4, u) * (1 - sstep(d - 0.5, d, u)), ph = TAU * 0.85 * u; yaw += 11 * e * Math.sin(ph); pitch += 12 * e * Math.cos(ph); roll += 8 * e * Math.sin(ph + 1.1); gx = -0.35 * e * Math.sin(ph * 1.7); gy = 0.3 * e * Math.cos(ph * 1.7); } }
  for (const k of ['yaw', 'pitch', 'roll']) { const v = k === 'yaw' ? yaw : k === 'pitch' ? pitch : roll, P = P_OF[k]; target[k] = cur[k] = clamp(v, P.min, P.max); }
  target.bodyX = clamp(hv[0] * 0.45 + act.leanNow, -1, 1);
  body.act = by;
  // --- 目: 見る先から、頭が向いたぶんを引く（頭が追いつくと、目は正面へ戻る）
  autoGaze(time);
  target.gazeX = clamp((act.L[0] - hv[0]) * 1.5 + saccade.x * 0.5 + gx, -1, 1);
  target.gazeY = clamp(-(act.L[1] - hv[1]) * 1.5 + saccade.y * 0.5 + gy, -1, 1);
  act.eyeR = act.eyeNow; act.eyeL = act.eyeNow * (1 - act.winkNow);
  target.mouthForm = clamp(P_OF.mouthForm.def + act.smileNow * 0.42, -1, 1);
  target.browY = brow;
}

function updateTargets(time) {
  if (EXPR_TEST && time >= 1000 && exprName !== EXPR_TEST) setExpr(EXPR_TEST);   // 確認用（?exprTest=笑顔）: 1 秒の所で、その表情に切り替える
  if (YAW_TEST) {   // 確認用（?yawTest=1）: 1 秒の所で、左いっぱいから右いっぱいへ振り向く。2.2 秒で正面へ戻る
    target.yaw = time < 1000 ? -30 : time < 2200 ? 30 : 0; target.roll = 0; target.pitch = 0; target.bodyX = 0;
    return;
  }
  if (shapeEdit) { for (const v of LS.VOWELS) oneHot[v] = v === shapeEdit ? 1 : 0; applyVowels(oneHot, 1, 1, 1); }
  else if (micOn && lip) trackMic();
  else if (talkDemo >= 0) trackTalkDemo(time);
  else if (lipDemo >= 0) trackLipDemo(time);
  if (mode === 'manual') return;
  if (mode === 'camera') { trackCamera(time); return; }
  if (mode === 'demo') runDemo(time);
  else {
    // マウス: カーソルの方を向く。体も少しついていく
    autoGaze(time);
    const tw = time / 1000;
    target.yaw = mouse.x * 28 + 1.5 * wob(tw, 1) + 1.0 * wob(tw * 0.23, 5);
    target.pitch = -mouse.y * 20 + 1.1 * wob(tw, 2.7) + 0.7 * wob(tw * 0.2, 9);
    target.roll = mouse.x * -7 + 1.3 * wob(tw * 0.8, 4.1) + 0.8 * wob(tw * 0.17, 7);
    target.bodyX = mouse.x * 0.5;
    target.gazeX = clamp(mouse.x * 0.8 + saccade.x, -1, 1);
    target.gazeY = clamp(mouse.y * 0.8 + saccade.y, -1, 1);
    if (previewT0 >= 0) {   // ためしの動き: 約 2.4 秒。左右に 1 往復半 → うなずき → もとの向きへ
      const u = tw - previewT0, D = 2.4;
      if (u >= D || u < 0) previewT0 = -1;
      else {
        const e = sstep(0, 0.12, u) * (1 - sstep(D - 0.45, D, u));
        target.yaw = lerp(target.yaw, 27 * Math.sin(TAU * u / 1.1) * (1 - sstep(1.3, 1.65, u)), e);
        target.pitch = lerp(target.pitch, -11 * Math.sin(Math.PI * clamp((u - 1.5) / 0.7, 0, 1)), e);
        target.roll = lerp(target.roll, 0, e); target.bodyX = lerp(target.bodyX, 0.3 * Math.sin(TAU * u / 1.1) * (1 - sstep(1.3, 1.65, u)), e);
      }
    }
  }
  const bl = autoBlink(time), ed = mode === 'demo';
  target.eyeR = Math.min(bl * (ed ? act.eyeR : 1), 1.2); target.eyeL = Math.min(bl * (ed ? act.eyeL : 1), 1.2);
}

// ---- UI --------------------------------------------------------------------
function setExpr(name) {
  if (!EXPR[name]) return;
  if (name !== exprName) {
    for (const k of EX_KEYS) exFrom[k] = EXPR[exprName][k] || 0;
    exprPrev = exprName; exprT0 = nowT;
    // 瞳の絵が替わる表情は、まばたきの間に替える（開いたまま絵が溶けて替わるのを見せない）
    const irisSet = (e) => (e.diffs || []).filter((d) => IRIS_DIFF.test(d)).join();
    if (tune.exprLive > 0 && mode !== 'manual' && irisSet(EXPR[name]) !== irisSet(EXPR[exprName]) && !blink.steps) blink.next = nowT;
  }
  exprName = name;
  for (const b of document.querySelectorAll('#exprs button')) b.classList.toggle('on', b.dataset.name === name);
}
let lastLive = 'mouse';   // 手で止める前の動かし方（「止めるのをやめる」で戻る先）
function setMode(m) {
  if (mode === 'demo' && m !== 'demo') setExpr('通常');   // おまかせ（ひとり芝居）が出していた表情を、残さない
  mode = m;
  if (m !== 'manual') lastLive = m;
  for (const o of document.querySelectorAll('#dirs button')) o.classList.remove('on');
  idle = !(m === 'manual' && fixed);
  for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === m);
  document.body.classList.toggle('mode-camera', m === 'camera');   // 鏡写しの切り替えは、カメラのときだけ出す
  document.body.classList.toggle('mode-manual', m === 'manual');   // 「止めるのをやめる」は、手で止めているときだけ出す
  if (m === 'camera') startCamera();
  else {
    $('#cam').style.display = 'none';
    status({ mouse: 'マウスカーソルの方を向きます', demo: 'ひとり芝居を、くり返し再生します（声は出ません）', manual: '向きや表情を、手で止めています（上の「動かし方」を押すと、戻ります）' }[m] || '');
  }
  if (m === 'camera' && camReady) $('#cam').style.display = 'block';
  if (m !== 'demo' && act.on) actStop();
  if (m === 'demo') act.t0 = null;
}
function buildSliders(root, list, store, onInput) {
  for (const p of list) {
    const l = document.createElement('label');
    l.className = 'sl';
    const step = p.step || (p.max - p.min) / 200;
    l.innerHTML = `<span>${p.label}</span><input type="range" min="${p.min}" max="${p.max}" step="${step}" value="${store[p.key]}"><span></span>`;
    const inp = l.children[1], val = l.children[2];
    const show = () => { val.textContent = p.fmt ? p.fmt(+inp.value) : (+inp.value).toFixed(p.max > 5 ? 0 : 2); };
    inp.addEventListener('input', () => { store[p.key] = +inp.value; show(); if (onInput) onInput(); });
    show();
    p.input = inp; p.show = show;
    root.appendChild(l);
  }
}
const pct = (v) => Math.round(v * 100) + '%';
// ---- 操作パネルの「折りたたみの項目」（好みに合わせる・キャラを作る人向けと、その中の項目）。ふだんは閉じておき、開閉はブラウザに覚えさせる
const SEC_KEY = 'keshin2d.ui.sections.v1';
let secOpen = {};
try { secOpen = JSON.parse(localStorage.getItem(SEC_KEY) || '{}'); } catch (e) { /* 保存が使えない環境では全部閉じたまま */ }
// （<details> は使わない。全部を閉じた状態で、ヘッドレス Chrome での撮影が固まった）
function wireSection(d) {
  const set = (on) => d.classList.toggle('open', on);
  const byUrl = (q.get('open') || '').split(',').includes(d.dataset.sec);   // URL の open=prefs,export でも開ける（確認用）
  set(!!secOpen[d.dataset.sec] || byUrl);
  if (byUrl) for (let p = d.parentElement.closest('.sec'); p; p = p.parentElement.closest('.sec')) p.classList.add('open');   // 中の項目を開くときは、外側も開く
  d.querySelector('.sechead').addEventListener('click', () => {
    set(!d.classList.contains('open'));
    secOpen[d.dataset.sec] = d.classList.contains('open');
    try { localStorage.setItem(SEC_KEY, JSON.stringify(secOpen)); } catch (e) { /* 保存できなくても動作は続ける */ }
  });
}
for (const d of document.querySelectorAll('.sec')) wireSection(d);
function uiSection(id, title) {
  const d = document.createElement('div'); d.className = 'sec'; d.dataset.sec = id;
  const hd = document.createElement('button'); hd.className = 'sechead'; hd.textContent = title; d.appendChild(hd);
  const body = document.createElement('div'); body.className = 'secbody'; d.appendChild(body);
  ($('#sections') || $('#ui')).appendChild(d);
  wireSection(d);
  return body;
}
const secManual = document.querySelector('.sec[data-sec="manual"]');
buildSliders($('#sliders'), PARAMS, target, () => { if (mode !== 'manual') setMode('manual'); });
// 調整値はブラウザに保存する（次に開いたときも同じ値で動く）
const TUNE_KEY = MODEL_NAME + '.tune.v1';
try { const saved = JSON.parse(localStorage.getItem(TUNE_KEY) || '{}'); for (const t of TUNE) if (typeof saved[t.key] === 'number') tune[t.key] = clamp(saved[t.key], t.min, t.max); } catch (e) { /* 保存が使えない環境では既定値のまま */ }
for (const t of TUNE) tune[t.key] = urlNum('tune', t.key, tune[t.key], t.min, t.max);   // URL の set=（OBS 用の URL）
const saveTune = () => { try { localStorage.setItem(TUNE_KEY, JSON.stringify(tune)); } catch (e) { /* 保存できなくても動作は続ける */ } };
const PREF_RESETS = [];   // 「好みを全部もとに戻す」が呼ぶ、項目ごとの戻し方
// ---- 好みに合わせる: 動きの好み（揺れ・体・瞳）。キャラの初期の動きに対する割合で決める。値はモデルごとにブラウザへ保存する
const USER_KEY = MODEL_NAME + '.user.v1';
try {
  const saved = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  for (const u of USER_ITEMS) if (typeof saved[u.key] === 'number') USER[u.key] = clamp(saved[u.key], u.min, u.max);
  for (const p of PHYS) if (typeof (saved.phys || {})[p.id] === 'number') p.ug = clamp(saved.phys[p.id], 0, 2);
} catch (e) { /* 保存が使えない環境では 100% のまま */ }
for (const u of USER_ITEMS) USER[u.key] = urlNum('user', u.key, USER[u.key], u.min, u.max);
for (const p of PHYS) p.ug = urlNum('uphys', p.id, p.ug, 0, 2);
const saveUser = () => { try { const o = Object.assign({ phys: {} }, USER); for (const p of PHYS) o.phys[p.id] = p.ug; localStorage.setItem(USER_KEY, JSON.stringify(o)); } catch (e) { /* 保存できなくても動作は続ける */ } };
{
  const root = $('#p_feel');
  root.insertAdjacentHTML('beforeend', '<h3>動きの好み</h3>');
  const PRESETS = [['おちついた', { sway: 0.5, body: 0.6, puru: 0.6 }], ['ふつう', { sway: 1, body: 1, puru: 1 }], ['元気', { sway: 1.5, body: 1.4, puru: 1.4 }]];
  const row = document.createElement('div'); row.className = 'row'; row.id = 'presets'; row.style.marginBottom = '6px'; root.appendChild(row);
  const mark = () => { for (const b of row.querySelectorAll('button[data-i]')) b.classList.toggle('on', USER_ITEMS.every((u) => Math.abs(USER[u.key] - PRESETS[+b.dataset.i][1][u.key]) < 0.005)); };
  const setAll = (o) => { for (const u of USER_ITEMS) { USER[u.key] = o[u.key]; u.input.value = o[u.key]; u.show(); } saveUser(); mark(); };
  // 揺れ方の違いは、キャラが動いたときにしか見えない。まとめボタンを押したとき・つまみを離したときに、ためしの動き（左右に振って、うなずく）を入れる
  PRESETS.forEach(([name], i) => { const b = document.createElement('button'); b.textContent = name; b.dataset.i = i; b.addEventListener('click', () => { setAll(PRESETS[i][1]); previewMotion(); }); row.appendChild(b); });
  const pv = document.createElement('button'); pv.id = 'feelpreview'; pv.className = 'ghost'; pv.textContent = '▶ ためしに動かす';
  pv.title = '顔を左右に振って、うなずきます（揺れ方の違いを見るため。動かし方が「マウス」のとき）';
  pv.addEventListener('click', previewMotion); row.appendChild(pv);
  for (const u of USER_ITEMS) u.fmt = pct;
  buildSliders(root, USER_ITEMS, USER, () => { saveUser(); mark(); });
  for (const u of USER_ITEMS) u.input.addEventListener('change', previewMotion);   // つまみを離したとき
  const note = document.createElement('div'); note.className = 'hint'; note.textContent = '100% が、このキャラの初期の動きです。値を変えると、ためしに顔を振って見せます（揺れ方の違いは、動いたときに見えます）。';
  root.appendChild(note);
  mark();
  PREF_RESETS.push(() => setAll(PRESETS[1][1]));
  // このキャラの飾り（model.json の physics。キャラごとに、数も名前も違う）を、1 つずつ決められる。無いキャラには、この欄そのものを出さない
  if (PHYS.length) {
    const tg = document.createElement('button'); tg.id = 'physuser'; tg.className = 'ghost'; tg.style.marginTop = '4px';
    const box = document.createElement('div'); box.id = 'physuserbox'; box.style.display = 'none';
    const lists = PHYS.map((p) => ({ p, it: { key: 'ug', label: p.label || p.id, min: 0, max: 2, def: 1, step: 0.05, fmt: pct } }));
    for (const { p, it } of lists) { buildSliders(box, [it], p, saveUser); it.input.addEventListener('change', previewMotion); }
    let open = false;
    const show = () => { box.style.display = open ? '' : 'none'; tg.textContent = (open ? '▾ ' : '▸ ') + '飾りごとに決める（' + PHYS.length + ' 個）'; };
    tg.addEventListener('click', () => { open = !open; show(); });
    root.appendChild(tg); root.appendChild(box); show();
    PREF_RESETS.push(() => { for (const { p, it } of lists) { p.ug = 1; it.input.value = 1; it.show(); } saveUser(); });
  }
}
// 9 方向ボタン。押すと、顔をその向きの「上限いっぱい」で止める（マウス追従などは止まる）。
// 止めたまま下の上限スライダーを動かすと、その場で顔が変わるので、崩れない所まで下げて決められる
{
  const root = $('#p_limits');
  root.insertAdjacentHTML('beforeend', '<h3>向きの上限</h3>');
  const note = document.createElement('div');
  note.textContent = '向きのボタンを押すと、その向きの上限いっぱいで顔が止まります。止めたまま、下の上限を動かして、崩れない所・好みの所に決めてください。';
  note.className = 'hint'; note.style.cssText = 'margin:0 0 6px';
  root.appendChild(note);
  const grid = document.createElement('div');
  grid.id = 'dirs';
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,52px);gap:4px;margin-bottom:8px';
  const DIRS = [['左上', -1, 1], ['上', 0, 1], ['右上', 1, 1], ['左', -1, 0], ['正面', 0, 0], ['右', 1, 0], ['左下', -1, -1], ['下', 0, -1], ['右下', 1, -1]];
  for (const [label, dx, dy] of DIRS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = (dy > 0 ? '上' : dy < 0 ? '下' : '') + (dx < 0 ? '左' : dx > 0 ? '右' : '') || '正面';
    b.style.cssText = 'padding:6px 0;text-align:center';
    b.addEventListener('click', () => {
      setMode('manual');
      const set = { yaw: dx * 30, pitch: dy * 25, roll: 0, bodyX: 0 };
      for (const pr of PARAMS) if (pr.key in set) { target[pr.key] = set[pr.key]; pr.input.value = set[pr.key]; pr.show(); }
      for (const o of grid.children) o.classList.toggle('on', o === b);
    });
    grid.appendChild(b);
  }
  root.appendChild(grid);
  const LIMITS = TUNE.slice(0, 4);   // 左右・上・下・かしげの上限
  buildSliders(root, LIMITS, tune, saveTune);
  const back = document.createElement('button');
  back.id = 'dirback'; back.textContent = '止めるのをやめる'; back.style.marginTop = '6px';
  back.title = '向きを止める前の動かし方（マウスなど）へ戻します';
  back.addEventListener('click', () => setMode(lastLive));
  root.appendChild(back);
  PREF_RESETS.push(() => { for (const t of LIMITS) { tune[t.key] = t.def; t.input.value = t.def; t.show(); } saveTune(); });
}
buildSliders($('#tune'), TUNE.slice(4), tune, saveTune);   // 残りは「キャラを作る人向け」
{
  const b = document.createElement('button');
  b.textContent = '顔の動き・髪の揺れを初期値に戻す（向きの上限も）';
  b.style.marginTop = '6px';
  b.addEventListener('click', () => { for (const t of TUNE) { tune[t.key] = t.def; t.input.value = t.def; t.show(); } saveTune(); });
  $('#tune').appendChild(b);
}
// ---- 口の色と線の太さ（ベクターの口を使うモデルだけ）。値はモデルごとにブラウザへ保存する
if (model.mouthVector && !keyMouth) {   // キーの形の口（描いた絵の口）のモデルでは、効かないので出さない
  const mv = model.mouthVector;
  const mdef = JSON.parse(JSON.stringify(mv));
  // 保存の名前に、モデルの初期値の要約を入れる。モデルの初期値が変わったら、前に保存した色は使わない
  // （前は、ブラウザに残った古い色が、新しい初期値を隠していた）
  let mh = 0; for (const ch of JSON.stringify(mdef)) mh = (mh * 31 + ch.charCodeAt(0)) >>> 0;
  const MKEY = MODEL_NAME + '.mouth.v2.' + mh.toString(36);
  const mouthItems = [
    { label: '線の色', get: () => mv.line, set: (v) => { mv.line = v; } },
    { label: '口の中（上）', get: () => mv.inside[0], set: (v) => { mv.inside[0] = v; } },
    { label: '口の中（下）', get: () => mv.inside[1], set: (v) => { mv.inside[1] = v; } },
    { label: '舌の色', get: () => mv.tongue, set: (v) => { mv.tongue = v; } },
    { label: '歯の色', get: () => mv.teeth, set: (v) => { mv.teeth = v; } },
  ];
  const applySaved = (o) => {
    if (!o) return;
    for (const k of ['line', 'tongue', 'teeth']) if (typeof o[k] === 'string') mv[k] = o[k];
    if (Array.isArray(o.inside) && o.inside.length === 2) mv.inside = [o.inside[0], o.inside[1]];
    for (const k of ['lineWidth', 'teethMax']) if (typeof o[k] === 'number') mv[k] = o[k];
  };
  try { applySaved(JSON.parse(localStorage.getItem(MKEY) || 'null')); } catch (e) { /* 保存が使えない環境では初期値のまま */ }
  const saveMouth = () => { try { localStorage.setItem(MKEY, JSON.stringify(mv)); } catch (e) { /* 同上 */ } };
  const root = uiSection('mouthColor', '口の色と線');
  const inputs = [];
  for (const it of mouthItems) {
    const l = document.createElement('label'); l.className = 'sl';
    l.innerHTML = `<span>${it.label}</span><input type="color" value="${it.get()}"><span></span>`;
    const inp = l.children[1], val = l.children[2];
    const show = () => { val.textContent = inp.value; };
    inp.addEventListener('input', () => { it.set(inp.value); show(); saveMouth(); });
    show(); inputs.push(() => { inp.value = it.get(); show(); });
    root.appendChild(l);
  }
  for (const sl of [{ key: 'lineWidth', label: '線の太さ', min: 1, max: 12 }, { key: 'teethMax', label: '歯の見える幅', min: 0, max: 30 }]) {
    const l = document.createElement('label'); l.className = 'sl';
    l.innerHTML = `<span>${sl.label}</span><input type="range" min="${sl.min}" max="${sl.max}" step="0.1" value="${mv[sl.key]}"><span></span>`;
    const inp = l.children[1], val = l.children[2];
    const show = () => { val.textContent = (+inp.value).toFixed(1); };
    inp.addEventListener('input', () => { mv[sl.key] = +inp.value; show(); saveMouth(); });
    show(); inputs.push(() => { inp.value = mv[sl.key]; show(); });
    root.appendChild(l);
  }
  const b = document.createElement('button');
  b.textContent = '口の色と線を初期値に戻す'; b.style.marginTop = '6px';
  b.addEventListener('click', () => { applySaved(mdef); for (const f of inputs) f(); saveMouth(); });
  root.appendChild(b);
}
// ---- 揺れ物（model.json の physics があるモデルだけ）。値はモデルごとにブラウザへ保存する（モデルの初期値が変わったら、前に保存した値は使わない。瞳の動きと同じ）。
// 前は、初期値が変わっても、ブラウザに残った前の値が優先され、モデルを作り直しても、その人の画面では動きが変わらなかった
let physHash = 0; for (const ch of JSON.stringify(PHYS.map((s) => [s.id, s.type, s.def]))) physHash = (physHash * 31 + ch.charCodeAt(0)) >>> 0;
const PHYS_KEY = MODEL_NAME + '.phys.v1.' + physHash.toString(36);
if (PHYS.length) {
  try {
    const saved = JSON.parse(localStorage.getItem(PHYS_KEY) || '{}');
    for (const s of PHYS) for (const sl of PHYS_SLIDERS) { const v = (saved[s.id] || {})[sl.key]; if (typeof v === 'number') s[sl.key] = clamp(v, sl.min, sl.max); }
  } catch (e) { /* 保存が使えない環境では初期値のまま */ }
  for (const s of PHYS) for (const sl of PHYS_SLIDERS) { const v = ((URLSET.phys || {})[s.id] || {})[sl.key]; if (typeof v === 'number' && isFinite(v)) s[sl.key] = clamp(v, sl.min, sl.max); }   // URL の set=
  const physOut = () => { const o = {}; for (const s of PHYS) { o[s.id] = {}; for (const sl of PHYS_SLIDERS) o[s.id][sl.key] = Math.round(s[sl.key] * 100) / 100; } return o; };
  const savePhys = () => { try { localStorage.setItem(PHYS_KEY, JSON.stringify(physOut())); } catch (e) { /* 同上 */ } };
  model.physicsOut = physOut;
  const root = uiSection('physics', `揺れ物（${PHYS.length} 個）`);   // 1 つずつの名前（model.json の physics の label）は、下の各行に出す
  const lists = [];
  for (const s of PHYS) {
    const t = document.createElement('div'); t.textContent = s.label || s.id; t.style.cssText = 'margin-top:6px;color:#cfd3e0';
    root.appendChild(t);
    const list = PHYS_SLIDERS.map((sl) => Object.assign({}, sl));
    buildSliders(root, list, s, savePhys);
    lists.push([s, list]);
  }
  const b = document.createElement('button');
  b.textContent = '揺れ物を初期値に戻す'; b.style.marginTop = '6px';
  b.addEventListener('click', () => { for (const [s, list] of lists) for (const sl of list) { s[sl.key] = s.def[sl.key]; sl.input.value = s[sl.key]; sl.show(); } savePhys(); });
  root.appendChild(b);
}
// ---- 瞳の動き。値はモデルごとにブラウザへ保存する（モデルの初期値が変わったら、前に保存した値は使わない）
{
  let hsh = 0; for (const ch of JSON.stringify(EYE_TUNE.map((t) => t.def))) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const EKEY = MODEL_NAME + '.eye.v1.' + hsh.toString(36);
  try { const saved = JSON.parse(localStorage.getItem(EKEY) || '{}'); for (const t of EYE_TUNE) if (typeof saved[t.key] === 'number') eyeTune[t.key] = clamp(saved[t.key], t.min, t.max); } catch (e) { /* 保存が使えない環境では初期値のまま */ }
  for (const t of EYE_TUNE) if (q.has(t.key)) eyeTune[t.key] = +q.get(t.key);
  for (const t of EYE_TUNE) eyeTune[t.key] = urlNum('eye', t.key, eyeTune[t.key], t.min, t.max);   // URL の set=
  const saveEye = () => { try { localStorage.setItem(EKEY, JSON.stringify(eyeTune)); } catch (e) { /* 同上 */ } };
  const root = uiSection('eye', '瞳の動き（ぷるん・うるみ）');
  const note = document.createElement('div');
  note.textContent = 'まばたきのあと、瞳がぷるんと揺れます。「まばたきさせる」を押すと、すぐに見られます。0 にすると、その動きは無くなります。';
  note.style.cssText = 'color:#9aa0b0;margin-bottom:6px';
  root.appendChild(note);
  const bb = document.createElement('button'); bb.id = 'blinkNow'; bb.textContent = 'まばたきさせる'; bb.style.marginBottom = '6px';
  bb.addEventListener('click', () => { if (mode === 'manual' || mode === 'camera') setMode('mouse'); if (!blink.steps) blink.next = 0; });
  root.appendChild(bb);
  buildSliders(root, EYE_TUNE, eyeTune, saveEye);
  const b = document.createElement('button');
  b.textContent = '瞳の動きを初期値に戻す'; b.style.marginTop = '6px';
  b.addEventListener('click', () => { for (const t of EYE_TUNE) { eyeTune[t.key] = t.def; t.input.value = t.def; t.show(); } saveEye(); });
  root.appendChild(b);
}
// ---- 母音の口の大きさ（好みに合わせる）。母音を選ぶと、その形のまま口が止まり、スライダーで形を決められる
let vowelsOut = null;   // 「OBS 用の URL」に入れる、母音の形（初期値と違う物だけ）
if (model.mouthVector && model.mouthVector.style === 2) {
  const root = $('#vowels');
  root.insertAdjacentHTML('beforeend', '<h3>母音の口の大きさ</h3>');
  const note = document.createElement('div'); note.className = 'hint'; note.style.cssText = 'margin:0 0 6px';
  note.textContent = '母音を押すと、その口の形で止まります。下のスライダーで、声を出したときの、いちばん大きく開いた形を決めてください。もう一度押すと、止めるのをやめます。';
  root.appendChild(note);
  const JA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };
  const row = document.createElement('div'); row.className = 'row'; row.id = 'vowelrow'; root.appendChild(row);
  const box = document.createElement('div'); box.style.marginTop = '6px'; root.appendChild(box);
  // キーの形の口では、絵に掛ける足し（KM_SHAPE）のスライダーにする。ベクターの口では、今までどおり VOWEL_SHAPE
  const S_KEYS = keyMouth ? KM_SHAPE_KEYS : SHAPE_KEYS, S_VAL = keyMouth ? KM_SHAPE : VOWEL_SHAPE, S_INIT = keyMouth ? KM_SHAPE_INIT : SHAPE_INIT, S_STORE = keyMouth ? KM_SHAPE_KEY : SHAPE_KEY;
  // ここに出すのは、開き・幅・上下の位置の 3 つ。式で描く口（前の作り方）の残りの項目は、「キャラを作る人向け」に出す
  const P_KEYS = S_KEYS.slice(0, 3), A_KEYS = S_KEYS.slice(3);
  const abox = A_KEYS.length ? uiSection('vowels', '母音の口の形（くわしく）') : null;
  if (abox) { const n2 = document.createElement('div'); n2.className = 'hint'; n2.style.marginTop = '0'; n2.textContent = '「好みに合わせる」の「母音の口の大きさ」で母音を選ぶと、その母音の、残りの項目がここに出ます。'; abox.appendChild(n2); }
  const saveShapes = () => { try { localStorage.setItem(S_STORE, JSON.stringify(S_VAL)); } catch (e) { /* 保存できなくても動作は続ける */ } };
  const shapesOut = () => { const o = {}; for (const v of LS.VOWELS) { o[v] = {}; for (const k of S_KEYS) o[v][k.key] = Math.round(S_VAL[v][k.key] * 100) / 100; } return o; };
  if (keyMouth) model.keyMouthShapesOut = shapesOut; else model.mouthShapesOut = shapesOut;
  vowelsOut = () => { const o = {}; for (const v of LS.VOWELS) for (const k of S_KEYS) if (Math.abs(S_VAL[v][k.key] - S_INIT[v][k.key]) > 1e-6) (o[v] = o[v] || {})[k.key] = Math.round(S_VAL[v][k.key] * 1000) / 1000; return o; };
  const groups = {}, btns = {};
  const pick = (v) => {
    shapeEdit = shapeEdit === v ? '' : v;
    if (!shapeEdit && !micOn) restMouth();
    for (const k of LS.VOWELS) { const on = k === shapeEdit; btns[k].classList.toggle('on', on); groups[k].el.style.display = on ? '' : 'none'; if (groups[k].ael) groups[k].ael.style.display = on ? '' : 'none'; }
  };
  for (const v of LS.VOWELS) {
    const b = document.createElement('button'); b.textContent = JA[v]; b.addEventListener('click', () => pick(v)); row.appendChild(b); btns[v] = b;
    const el = document.createElement('div'); el.style.display = 'none'; box.appendChild(el);
    const list = P_KEYS.map((k) => Object.assign({}, k, keyMouth && k.key !== 'y' ? { fmt: pct } : {}));
    buildSliders(el, list, S_VAL[v], saveShapes);
    let ael = null, alist = [];
    if (abox) { ael = document.createElement('div'); ael.style.display = 'none'; abox.appendChild(ael); alist = A_KEYS.map((k) => Object.assign({}, k)); buildSliders(ael, alist, S_VAL[v], saveShapes); }
    const resetOne = () => { for (const k of list.concat(alist)) { S_VAL[v][k.key] = S_INIT[v][k.key]; k.input.value = S_VAL[v][k.key]; k.show(); } };
    const r = document.createElement('button'); r.textContent = '「' + JA[v] + '」を初期値に戻す'; r.style.marginTop = '4px';
    r.addEventListener('click', () => { resetOne(); saveShapes(); });
    el.appendChild(r);
    groups[v] = { el, ael, resetOne };
  }
  PREF_RESETS.push(() => { for (const v of LS.VOWELS) groups[v].resetOne(); saveShapes(); });
  if (shapeEdit) { const v = shapeEdit; shapeEdit = ''; if (btns[v]) pick(v); }
} else $('#vowels').style.display = 'none';
// ---- マイクの口パク（好みに合わせる）。値はブラウザに保存する（キャラではなく、話す人とマイクに付く値）
{
  const root = $('#p_lip');
  root.insertAdjacentHTML('beforeend', '<h3>マイクの口パク</h3>');
  const LIP_ITEMS = [
    { key: 'gain', label: '口パクの大きさ', min: 0.3, max: 3, def: 1, fmt: pct },
    { key: 'gate', label: '小さい音を無視', min: 0.002, max: 0.06, def: 0.012, fmt: (v) => v.toFixed(3) },
    { key: 'scale', label: '声の高さ', min: 0.85, max: 1.5, def: 1.15 },
  ];
  buildSliders(root, LIP_ITEMS, lipSet, () => LS.saveSettings(lipSet));
  PREF_RESETS.push(() => { for (const k of LIP_ITEMS) { lipSet[k.key] = k.def; k.input.value = k.def; k.show(); } LS.saveSettings(lipSet); });
  const note = document.createElement('div'); note.className = 'hint';
  note.textContent = '口の形が声と合わないときは、「声を覚えさせる」を押して、案内のとおりに「あー」「いー」…と 1 つずつ、のばして言ってください。';
  root.appendChild(note);
  const JA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };
  const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '6px';
  const info = document.createElement('div'); info.id = 'lipinfo'; info.className = 'hint'; info.style.minHeight = '1.5em';
  const showCal = () => { const c = lipSet.centers || {}; info.textContent = '覚えた声: ' + (LS.VOWELS.filter((v) => c[v]).map((v) => JA[v]).join(' ') || 'なし（一般的な値 ×「声の高さ」を使っています）'); };
  // 声を覚えさせる: あ → お を、1 つずつ案内する（押してから言い始めるまでの間を取る）
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let busy = false;
  const learn = async (list, btn) => {
    if (busy) return;
    busy = true; btn.classList.add('on');
    try {
      if (!lip) { $('#mic').checked = true; await startMic(); }
      if (!lip) { info.textContent = 'マイクを使えませんでした。ブラウザの、マイクの許可を確かめてください。'; return; }
      for (let i = 0; i < list.length; i++) {
        const v = list[i], cnt = list.length > 1 ? '（' + (i + 1) + ' / ' + list.length + '）' : '';
        let r = null;
        for (let k = 0; k < 2 && !r && lip; k++) {
          info.textContent = (k ? '聞き取れませんでした。もう一度、' : '') + '「' + JA[v] + 'ー」と、のばして言ってください…' + cnt;
          await wait(700);
          if (lip) r = await lip.calibrate(v, 1300);
        }
        if (!r) { info.textContent = '「' + JA[v] + '」が聞き取れませんでした。静かな所で、もう一度押してください。'; return; }
      }
      showCal();
    } finally { busy = false; btn.classList.remove('on'); }
  };
  const wiz = document.createElement('button'); wiz.id = 'lipwiz'; wiz.textContent = '声を覚えさせる';
  wiz.title = '「あ」から「お」まで、順に 1 秒ずつ、あなたの声を覚えます';
  wiz.addEventListener('click', () => learn(LS.VOWELS, wiz));
  row.appendChild(wiz);
  const row2 = document.createElement('div'); row2.className = 'row hint'; row2.style.gap = '2px';
  row2.appendChild(document.createTextNode('1 つだけ覚え直す:'));
  for (const v of LS.VOWELS) {
    const b = document.createElement('button'); b.textContent = JA[v]; b.className = 'ghost mini';
    b.title = '「' + JA[v] + '」だけ、覚え直す';
    b.addEventListener('click', () => learn([v], b));
    row2.appendChild(b);
  }
  const clr = document.createElement('button'); clr.textContent = '忘れる'; clr.className = 'ghost';
  clr.addEventListener('click', () => { lipSet.centers = null; LS.saveSettings(lipSet); showCal(); });
  row.appendChild(clr);
  root.appendChild(row); root.appendChild(row2); root.appendChild(info); showCal();
  // 口のデモ（音は出さない）: 「口パクデモ」は、ふだんの画面に置く。「あいうえお」は、母音の口の大きさの所に置く
  const demos = $('#demos');
  const talk = document.createElement('button'); talk.id = 'talkdemo'; talk.textContent = '口パクデモ';
  talk.title = 'せりふの母音どおりに口を動かします（音は出ません）。もう一度押すと止まります';
  const showTalk = () => talk.classList.toggle('on', talkDemo >= 0);
  talk.addEventListener('click', () => { if (talkDemo >= 0) { talkDemo = -1; if (!micOn) restMouth(); } else talkDemo = performance.now() / 1000; showTalk(); });
  demos.appendChild(talk); showTalk();
  const demo = document.createElement('button'); demo.id = 'aiueo'; demo.textContent = 'あいうえお と言わせる';
  demo.title = '「あ・い・う・え・お」を順に 2 回言わせます（音は出ません）';
  demo.addEventListener('click', () => { talkDemo = -1; showTalk(); lipDemo = performance.now() / 1000; });
  const vr = $('#vowelrow');
  if (vr) { demo.className = 'ghost'; vr.appendChild(demo); } else demos.appendChild(demo);
}
// ---- 「好みを全部もとに戻す」（動きの好み・向きの上限・マイクの口パクの 3 本・母音の口の大きさ。覚えた声は、消さない）
{
  const b = document.createElement('button'); b.id = 'prefreset'; b.className = 'wide'; b.textContent = '好みを全部もとに戻す';
  b.title = '動きの好み・向きの上限・マイクの口パク・母音の口の大きさを、このキャラの初期値に戻します（覚えた声は、消しません）';
  b.style.marginTop = '14px';
  b.addEventListener('click', () => { for (const f of PREF_RESETS) f(); });
  $('#p_reset').appendChild(b);
}
// ---- 調整した値を、キャラの設定ファイル（partsgen/chars/<キャラ名>/char.json）へ入れる形で書き出す
{
  const root = uiSection('export', '今の調整値を書き出す（初期値にする）');
  const b = document.createElement('button');
  b.textContent = '今の調整値を書き出す';
  // 文字の欄は、押されたときに初めて作る（最初から置くと、ヘッドレス Chrome での撮影が時々固まった）
  let ta = null;
  const makeTa = () => {
    ta = document.createElement('textarea');
    ta.readOnly = true; ta.rows = 9; ta.spellcheck = false; ta.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;font:11px/1.4 Consolas,monospace;background:#1b1c22;color:#e8e8ea;border:1px solid #474a58;border-radius:6px';
    root.insertBefore(ta, msg);
  };
  const msg = document.createElement('div'); msg.style.cssText = 'color:#9aa0b0;margin-top:4px';
  b.addEventListener('click', () => {
    const r2 = (v) => Math.round(v * 100) / 100;
    // 口の形・口の幅は、「手で動かす」で決めた値。ほかの動かし方（おまかせ・カメラ）では、動いている最中の値（ほほえみの途中など）を拾わず、今の初期値を出す
    const pv = (k) => r2(mode === 'manual' ? target[k] : P_OF[k].def);
    const o = { tune: {}, params: { mouthForm: pv('mouthForm'), mouthWidth: pv('mouthWidth') } };
    for (const t of TUNE) o.tune[t.key] = r2(tune[t.key]);
    if (model.mouthVector) o.mouthVector = model.mouthVector;
    if (LAYERS.some((L) => L.path === '頭/帽子') && !PHYS_BY_LAYER['帽子']) o.hat = { sway: r2(HAT_SWAY) };
    if (model.physicsOut) o.physics_tune = model.physicsOut();
    if (model.mouthShapesOut) o.mouthShapes = model.mouthShapesOut();
    if (model.keyMouthShapesOut) o.keyMouthShapes = model.keyMouthShapesOut();
    o.eyeTune = {}; for (const t of EYE_TUNE) o.eyeTune[t.key] = r2(eyeTune[t.key]);
    if (!ta) makeTa();
    ta.value = JSON.stringify(o, null, 1); ta.select();
    const done = (ok) => { msg.textContent = (ok ? 'コピーしました。' : '下の文字を選んでコピーしてください。') + 'char.json の同じ名前の項目（tune・params・mouthVector・hat・physics_tune・mouthShapes・keyMouthShapes・eyeTune）と置き換えて、モデルを書き出し直すと初期値になります。口の形・口の幅は、「手で動かす」で動かしているときは、そのスライダーの今の値、それ以外のときは、今の初期値です。「動きの好み」の % は、使う人の好みなので、入りません。'; };
    done(false);   // 先に案内を出す（コピーの結果が返ってこない環境がある）
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(() => done(true), () => done(false));
  });
  root.appendChild(b); root.appendChild(msg);
}
// ---- 表情のボタン。よく使う物を上に並べ、残りは「ほかの表情」に入れる。上の物は、数字キー（1〜9・0）でも切り替えられる
{
  // そのモデルに、要る絵がある表情だけを出す（キャラによって、瞳の差分（ハート・キラキラ・ぐるぐる）などが無いことがある。
  // 差分を使う表情は、その差分が 1 つも無ければ出さない。瞳を描き替える表情は、その瞳の絵が無ければ出さない）
  const haveDiff = new Set(parts.filter((p) => p.diff).map((p) => p.diff));
  const usable = (n) => { const d = EXPR[n].diffs || []; return !d.length || (d.some((x) => haveDiff.has(x)) && d.every((x) => !/ハート|しいたけ|ぐるぐる/.test(x) || haveDiff.has(x))); };
  const names = Object.keys(EXPR).filter(usable);
  const want = ['通常', 'にこ', '笑顔', '照れ', '怒り', 'びっくり', '困り', 'ウインク'].filter((n) => names.includes(n));
  const favs = want.length >= 5 ? want : names.slice(0, 8);   // その表情が無いモデル（前の作り方）では、先頭から 8 個
  const xr = $('#exprs'), fr = xr.querySelector('.favs'), mr = xr.querySelector('.more');
  const add = (name, root, key) => {
    const b = document.createElement('button');
    b.dataset.name = name; b.textContent = name;
    if (key !== undefined) { const k = document.createElement('kbd'); k.textContent = key; b.appendChild(k); b.title = '数字キー ' + key + ' でも切り替え'; }
    b.addEventListener('click', () => setExpr(name));
    root.appendChild(b);
  };
  favs.forEach((n, i) => add(n, fr, i < 10 ? String((i + 1) % 10) : undefined));
  const rest = names.filter((n) => !favs.includes(n));
  for (const n of rest) add(n, mr);
  const tg = $('#exprtoggle'), OPEN_KEY = 'keshin2d.ui.exprs.v1';
  let open = false;
  try { open = localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { /* 保存が使えない環境では閉じたまま */ }
  const show = () => { xr.classList.toggle('open', open); tg.textContent = open ? '▾ ほかの表情を閉じる' : '▸ ほかの表情（' + rest.length + '）'; };
  tg.addEventListener('click', () => { open = !open; try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) { /* 同上 */ } show(); });
  if (!rest.length) tg.parentElement.style.display = 'none';
  show();
}
{ const nm = $('#modelname'); if (nm) nm.textContent = MODEL_NAME; }
// モデルを選ぶ欄。models/index.json（{"models": [{"name": フォルダ名, "label": 表示名}, …]}）に 2 体以上あれば、名前の表示の代わりに出す。
// tools/serve.py は、この一覧に、models/ の中にあるほかのモデル（自分で作った物）を足して返す。一覧が無い・読めないときは、名前の表示だけ。
fetch('models/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
  const sel = $('#modelsel'), nm = $('#modelname');
  const list = (j && Array.isArray(j.models) ? j.models : []).filter((m) => m && /^[A-Za-z0-9_\-]+$/.test(m.name || ''));
  if (!sel || !list.length) return;
  if (!list.some((m) => m.name === MODEL_NAME)) list.push({ name: MODEL_NAME });   // 一覧に無いモデルを開いているときも、選ばれた状態で出す
  if (list.length < 2) return;
  for (const m of list) { const o = document.createElement('option'); o.value = m.name; o.textContent = m.label || m.name; o.title = m.name; sel.appendChild(o); }
  sel.value = MODEL_NAME; sel.hidden = false; if (nm) nm.hidden = true;
  // 選んだら、そのモデルで開き直す。配置・表情・調整の指定は、モデルごとの物なので引き継がない（髪の表示と背景だけ引き継ぐ）
  sel.addEventListener('change', () => { const p = new URLSearchParams(); p.set('model', sel.value); for (const k of ['hair', 'bg']) if (q.has(k)) p.set(k, q.get(k)); location.search = p.toString(); });
}).catch(() => { /* 一覧が無ければ、名前の表示だけ */ });
// 「マウス」を押したら、表情も通常に戻す（いつでも、最初の状態へ戻れるように）
for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => { if (b.dataset.mode === 'mouse') setExpr('通常'); setMode(b.dataset.mode); });
$('#mic').addEventListener('change', (e) => { if (e.target.checked) startMic(); else stopMic(); });
{ // マイクの音の大きさと、いま聞こえている母音（ふだんの画面）
  const bar = $('#micmeter i'), vw = $('#micvowel'), JA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };
  let last = '';
  setInterval(() => {
    const w = micOn ? Math.round(100 * clamp(Math.sqrt(lipNow.vol) * 1.8, 0, 1)) + '%' : '0';
    if (w !== last) { bar.style.width = w; last = w; }
    const t = micOn ? (JA[lipNow.top] || '') : '';
    if (vw.textContent !== t) vw.textContent = t;
  }, 80);
}
$('#mirror').addEventListener('change', (e) => { mirror = e.target.checked; });
const BGS = ['room', 'dark', 'white', 'green', 'transparent'];
const setBg = (v) => {
  if (!BGS.includes(v)) return;
  document.body.className = document.body.className.replace(/bg-\w+/, 'bg-' + v);
  for (const b of document.querySelectorAll('#bgs button')) b.classList.toggle('on', b.dataset.bg === v);
};
for (const b of document.querySelectorAll('#bgs button')) b.addEventListener('click', () => setBg(b.dataset.bg));
setBg('room');
// パネルを隠す・出す。隠したあとは、マウスを動かすと、隅に「出す」ボタンが出る（URL の ui=0 で開いたときは、出さない = 配信の画面に写らない）
const toggleUi = () => document.body.classList.toggle('noui');
$('#hide').addEventListener('click', toggleUi);
$('#showui').addEventListener('click', toggleUi);
{
  let t = 0;
  addEventListener('mousemove', () => {
    if (!document.body.classList.contains('noui')) return;
    document.body.classList.add('peek'); clearTimeout(t);
    t = setTimeout(() => document.body.classList.remove('peek'), 2500);
  });
}
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const el = e.target || {}, tag = el.tagName || '';
  if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox')) return;   // 文字を打つ欄では、効かせない
  if (e.key === 'h' || e.key === 'H') { toggleUi(); return; }
  if (/^[0-9]$/.test(e.key)) { const b = document.querySelectorAll('#exprs .favs button')[(+e.key + 9) % 10]; if (b) setExpr(b.dataset.name); }   // 1〜9・0 = 上に並んだ表情
});
// ---- OBS 用の URL: 今の配置・動かし方と、調整した値（キャラの初期値と違う物だけ）を入れた URL を作る。
// 調整した値はブラウザに覚えるだけなので、OBS のブラウザソース（別の保存場所）には、そのままでは引き継がれない
$('#obsurl').addEventListener('click', () => {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const set = {};
  const put = (g, k, v) => { (set[g] = set[g] || {})[k] = r3(v); };
  for (const u of USER_ITEMS) if (Math.abs(USER[u.key] - u.def) > 1e-6) put('user', u.key, USER[u.key]);
  for (const t of TUNE) if (Math.abs(tune[t.key] - t.def) > 1e-6) put('tune', t.key, tune[t.key]);
  for (const t of EYE_TUNE) if (Math.abs(eyeTune[t.key] - t.def) > 1e-6) put('eye', t.key, eyeTune[t.key]);
  for (const s of PHYS) for (const sl of PHYS_SLIDERS) if (Math.abs(s[sl.key] - s.def[sl.key]) > 1e-6) { set.phys = set.phys || {}; (set.phys[s.id] = set.phys[s.id] || {})[sl.key] = r3(s[sl.key]); }
  for (const ph of PHYS) if (Math.abs(ph.ug - 1) > 1e-6) put('uphys', ph.id, ph.ug);
  if (vowelsOut) { const vo = vowelsOut(); if (Object.keys(vo).length) set.vowels = vo; }
  const p = new URLSearchParams();
  p.set('model', MODEL_NAME); p.set('ui', '0'); p.set('bg', 'transparent');
  if (!showHair) p.set('hair', '0');
  if (mode === 'camera' || mode === 'demo') p.set('mode', mode);
  p.set('cx', Math.round(VIEW.cx)); p.set('cy', Math.round(VIEW.cy)); p.set('zoom', r3(1060 / VIEW.half));
  if (Object.keys(set).length) p.set('set', JSON.stringify(set));
  const url = location.origin + location.pathname + '?' + p.toString();
  const msg = $('#obsmsg');
  let box = $('#obsbox');
  if (!box) {   // 文字の欄は、押されたときに初めて作る（最初から置くと、ヘッドレス Chrome での撮影が時々固まった）
    box = document.createElement('input'); box.id = 'obsbox'; box.type = 'text'; box.readOnly = true; box.spellcheck = false;
    box.style.cssText = 'width:100%;box-sizing:border-box;margin-top:6px;font:11px/1.4 Consolas,monospace;background:#1b1c22;color:#e8e8ea;border:1px solid #474a58;border-radius:6px;padding:4px 6px';
    msg.parentElement.insertBefore(box, msg);
  }
  box.value = url; box.select();
  const tail = 'OBS の「ブラウザ」ソースの URL に貼ってください。起動した黒い窓（サーバー）は、開いたままにします。調整を変えたら、もう一度コピーして貼り直します（マイクの声の覚えは、URL には入りません）。';
  const done = (ok) => { msg.textContent = (ok ? 'コピーしました。' : '上の文字を選んでコピーしてください。') + tail; };
  done(false);   // 先に案内を出す（コピーの結果が返ってこない環境がある）
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
});

// URL で初期状態を指定できる。例: ?bg=transparent&ui=0&mode=camera / ?yaw=20&eyeR=0.3&exp=笑顔
if (q.get('bg')) setBg(q.get('bg'));
if (q.get('ui') === '0') document.body.classList.add('noui', 'pure');
let fixed = false;
for (const p of PARAMS) {
  if (q.has(p.key)) { target[p.key] = cur[p.key] = clamp(+q.get(p.key), p.min, p.max); fixed = true; }
}
for (const t of TUNE) if (q.has(t.key)) tune[t.key] = +q.get(t.key);
if (q.has('exp')) { fixed = true; }
setMode(fixed ? 'manual' : mode);
setExpr(q.get('exp') || '通常');
if (fixed) {   // 固定表示のときは、表情を最初から掛けきった状態にする（確認用の撮影で使う）
  const e = EXPR[exprName];
  for (const k of EX_KEYS) ex[k] = e[k] || 0;
  ex.eyeMul = e.eyeMul ?? 1; ex.mouthWidth = e.mouthWidth ?? 1; ex.eyeMulR = e.eyeMulR ?? 1; ex.eyeMulL = e.eyeMulL ?? 1;
  for (const d of e.diffs || []) diffW[d] = 1;
}

// ---- メインループ ----------------------------------------------------------
function step(time, dt) {
  updateTargets(time);
  if (EXT && EXT.frame) EXT.frame(time / 1000, dt, target);   // BOXP-716: 座り具合と台本
  for (const p of PARAMS) {
    if (GAZE_SPRING[p.key]) gazeStep(GAZE_SPRING[p.key], p.key, dt);
    else cur[p.key] += (target[p.key] - cur[p.key]) * (1 - Math.exp(-dt * p.k));
    if (mode !== 'manual' && p.input && (!secManual || secManual.classList.contains('open'))) { p.input.value = cur[p.key]; p.show(); }   // 閉じている間は、スライダーを書き換えない
  }
  // 表情はなめらかに切り替える
  nowT = time;
  const e = EXPR[exprName], kx = 1 - Math.exp(-dt * 11), xl = tune.exprLive, tEx = (time - exprT0) / 1000;
  if (xl <= 0) for (const k of EX_KEYS) ex[k] += ((e[k] || 0) - ex[k]) * kx;
  else {
    const nS = Math.max(1, Math.ceil(dt / 0.008)), hS = dt / nS, x1 = Math.min(xl, 1);
    for (const k of EX_KEYS) {
      const D = EX_DYN[k] || EX_DYN.mouthOpen, tg = tEx < D.t * x1 ? (exFrom[k] ?? (e[k] || 0)) : (e[k] || 0);
      const om = TAU * D.f, d = xl <= 1 ? lerp(1, D.d, xl) : lerp(D.d, D.d * 0.6, xl - 1);
      let v = exV[k] || 0;
      for (let i = 0; i < nS; i++) { v += (om * om * (tg - ex[k]) - 2 * d * om * v) * hS; ex[k] += v * hS; }
      exV[k] = v;
    }
  }
  ex.eyeMul += ((e.eyeMul ?? 1) - ex.eyeMul) * (1 - Math.exp(-dt * 22));
  ex.eyeMulR += ((e.eyeMulR ?? 1) - ex.eyeMulR) * (1 - Math.exp(-dt * 22)); ex.eyeMulL += ((e.eyeMulL ?? 1) - ex.eyeMulL) * (1 - Math.exp(-dt * 22));
  ex.mouthWidth += ((e.mouthWidth ?? 1) - ex.mouthWidth) * kx;
  // 差分の絵（瞳・赤面など）: まばたきで隠して替えるときは、目が閉じるまで待ってから、すばやく替える
  const hideSwap = xl > 0 && mode !== 'manual' && tEx < 0.4 && !!blink.steps;
  const on = new Set(((hideSwap && tEx < 0.075 ? EXPR[exprPrev] : e).diffs) || []);
  const kd = hideSwap ? 1 - Math.exp(-dt * 40) : kx;
  for (const p of parts) if (p.diff) diffW[p.diff] = (diffW[p.diff] || 0) + ((on.has(p.diff) ? 1 : 0) - (diffW[p.diff] || 0)) * kd;
  resize();
  render(time, dt);
}
let last = performance.now();
function frame(time) {
  const dt = clamp((time - last) / 1000, 0.001, 0.1);
  last = time;
  step(time, dt);
  requestAnimationFrame(frame);
}
status('');
setMode(fixed ? 'manual' : mode);
// 確認用: ?dir=0〜8 で方向ボタンを押した状態から始める
if (q.has('dir')) { const d = document.querySelectorAll('#dirs button')[+q.get('dir')]; if (d) d.click(); }
if (q.has('sim')) {
  // 確認用: ?mode=demo&sim=7.5 のように指定すると、その秒数ぶんを一気に進めた瞬間の絵で止まる
  // （mx / my でマウス位置も指定できる）
  if (q.has('mx')) mouse.x = +q.get('mx');
  if (q.has('my')) mouse.y = +q.get('my');
  const n = Math.round(+q.get('sim') * 60);
  const hold = () => { render(n * 1000 / 60, 1e-6); requestAnimationFrame(hold); };
  requestAnimationFrame(() => { for (let i = 1; i <= n; i++) { skipDraw = i < n; step(i * 1000 / 60, 1 / 60); } hold(); });
} else requestAnimationFrame(frame);
window.__ready = true;
// BOXP-716: 親の画面の台本（待機 → 話し始め、座ったまま視線を変える）から動かすための口。
window.__k2d = { mouse, target, cur, setExpr, setMode, VIEW, talk(on) { if (on) talkDemo = performance.now() / 1000; else { talkDemo = -1; restMouth(); } } };
window.__state = () => ({ mode, expr: exprName, yaw: cur.yaw, pitch: cur.pitch, user: Object.assign({}, USER) });   // 確認の道具（uicheck.mjs）が読む
// 揺れ物の今の状態（確認の道具 livecap.mjs --probe が読む。何回揺れて、何秒で止まるかを、数字で見るため）。J は、固い板（frame）の一次の変換
window.__phys = () => PHYS.map((s) => ({ id: s.id, phi: s.phi, phi2: s.phi2, by: s.by, J: s.frameObj ? Array.from(s.frameObj.J) : null }));

// ---- 計測用（?probe=1）: 今の姿勢で、頭の輪郭・あご先・瞳が画面のどこへ行くかをページのタイトルに書き出す。
// 顔のパーツの位置関係を、姿勢ごとに数字で比べるためのもの（読むのは partsgen/tools/ref/probe.mjs。奥の目と輪郭は eyeedge.py）
if (q.has('probe')) {
  setTimeout(() => {
    const o = [0, 0], Rr = model.curves.face.R, pts = [];
    for (let i = 0; i < Rr.length; i += 4) {
      const y = FACE_TOP + i;
      surfMap(SKIN, HX - Rr[i], y, o); const xl = o[0], yl = o[1];
      surfMap(SKIN, HX + Rr[i], y, o);
      pts.push([xl, yl, o[0], o[1]]);
    }
    surfMap(SKIN, HX, FACE_TOP, o); const top = [o[0], o[1]];
    surfMap(SKIN, HX, FACE_TOP + Rr.length - 1, o); const chin = [o[0], o[1]];
    const e = {};
    for (const k of ['R', 'L']) { eyes[k].group.apply(eyes[k].cx, eyes[k].cy, o); e[k] = [o[0], o[1]]; }
    // 鼻と口（基準点と、口の左右の端）。目・あご先との位置関係を、数字で比べるため
    const mg = mouth.group, mc = model.curves.mouth;
    nose.apply(nose.ax, nose.ay, o); const nz = [o[0], o[1]];
    mg.apply(mg.ax, mg.ay, o); const mo = [o[0], o[1]];
    mg.apply(mc.xa, mg.ay, o); const mL = [o[0], o[1]];
    mg.apply(mc.xb, mg.ay, o); const mR = [o[0], o[1]];
    document.title = 'PROBE' + JSON.stringify({ top, chin, e, pts, nose: nz, mouth: mo, mouthL: mL, mouthR: mR, R0, HX });
  }, 1500);
}
