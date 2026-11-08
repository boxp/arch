import { LATEST_MODEL_ID, lostPrototypes, modelFor, normalizeModelId, rigModels } from './model'

export function setupSelector(container: HTMLElement, includeSample: boolean): boolean {
  const params = new URLSearchParams(location.search)
  const id = normalizeModelId(params.get('model'))
  const lost = lostPrototypes.find(p => p.id === id)
  const model = modelFor(location.search)
  document.body.classList.toggle('full-model', (model.id === 'kohako-full-v1' || model.id === 'kohako-full-v2' || model.id === 'kohako-full-v3' || model.id === 'kohako-full-v4' || model.id === 'kohako-full-v5' || model.id === 'kohako-full-v6') && !lost)
  const select = document.createElement('select'); select.id = 'model-select'
  const label = document.createElement('label'); label.htmlFor = select.id; label.textContent = '試作の選択 '
  const all = [...rigModels.filter(m => includeSample || m.id !== 'sample'), ...lostPrototypes]
  all.sort((a, b) => {
    const number = (id: string) => {
      if (id === 'kohako') return 0
      if (id === 'sample') return 99
      const match = id.match(/v(\d+)([a-z])?(?:-video)?$/)
      return match ? Number(match[1]) + (match[2] ? (match[2].charCodeAt(0) - 96) / 100 : 0) : 98
    }
    return number(a.id) - number(b.id)
  })
  for (const item of all) {
    const option = document.createElement('option'); option.value = item.id
    const version = item.id === 'kohako' ? 'v0' : item.id === 'sample' ? 'サンプル' : item.id.replace('kohako-', '')
    option.textContent = `${version}（${'images' in item ? (item.id === 'kohako-v45-video' || item.id === 'kohako-v42' || item.id === 'kohako-v41' || item.id === 'kohako-v40' || item.id === 'kohako-v39' || item.id === 'kohako-v26' || item.id === 'kohako-v28' || item.id === 'kohako-v31' || item.id === 'kohako-v32' || item.id === 'kohako-v33' || item.id === 'kohako-v34') ? item.evaluation : '読込不能: 比較画像を表示' : item.evaluation}）`
    select.append(option)
  }
  select.value = lost?.id ?? (includeSample ? model.id : model.id === 'sample' ? LATEST_MODEL_ID : model.id)
  select.addEventListener('change', () => { params.set('model', select.value); location.search = params.toString() })
  const details = document.createElement('p')
  const selected = lost ?? (includeSample || model.id !== 'sample' ? model : modelFor(''))
  details.textContent = `${select.selectedOptions[0]?.textContent} — ${selected.evaluation}。問題: ${selected.problems} 最新の試作は ${LATEST_MODEL_ID.replace('kohako-', '')}（担当評価は選択欄を参照）です。`
  container.append(label, select, details)
  if ((model.id === 'kohako-full-v1' || model.id === 'kohako-full-v2' || model.id === 'kohako-full-v3' || model.id === 'kohako-full-v4' || model.id === 'kohako-full-v5' || model.id === 'kohako-full-v6') && !lost) {
    const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${model.id}-compare.jpg`; link.textContent = '原画・静止ポーズの比較'; container.append(link)
    if (model.id === 'kohako-full-v6') for (const [file, title] of [['kohako-full-v6-browser-faces.jpg', '実ブラウザの顔'], ['kohako-full-v6-eyes-crops.jpg', '目元'], ['kohako-full-v6-mouth-crops.jpg', '口元'], ['kohako-full-v6-eyes-sequence.jpg', '目の開閉'], ['kohako-full-v6-mouth-sequence.jpg', '口の開閉'], ['kohako-full-v6-hair-arms-crops.jpg', '髪・腕'], ['kohako-full-v6-feet-crops.jpg', '足元']]) { const crop = document.createElement('a'); crop.href = `./kohako/live2d/compare/${file}`; crop.textContent = ` ／ ${title}`; container.append(crop) }
    if (model.id === 'kohako-full-v5') for (const [file, title] of [['kohako-full-v5-browser-faces.jpg', '実ブラウザの顔'], ['kohako-full-v5-diagnostic.jpg', '描画倍率の診断'], ['kohako-full-v5-layer-atlas.jpg', '目口の層とアトラス'], ['kohako-full-v5-eyes-crops.jpg', '目元'], ['kohako-full-v5-mouth-crops.jpg', '口元'], ['kohako-full-v5-eyes-sequence.jpg', '目の開閉'], ['kohako-full-v5-mouth-sequence.jpg', '口の開閉'], ['kohako-full-v5-hair-arms-crops.jpg', '髪・腕'], ['kohako-full-v5-feet-crops.jpg', '足元']]) { const crop = document.createElement('a'); crop.href = `./kohako/live2d/compare/${file}`; crop.textContent = ` ／ ${title}`; container.append(crop) }
    if (model.id === 'kohako-full-v4') for (const [file, title] of [['kohako-full-v4-eyes-sequence.jpg', '目の開閉'], ['kohako-full-v4-mouth-sequence.jpg', '口の開閉'], ['kohako-full-v4-hair-arms-crops.jpg', '髪・腕'], ['kohako-full-v4-feet-crops.jpg', '足元']]) { const crop = document.createElement('a'); crop.href = `./kohako/live2d/compare/${file}`; crop.textContent = ` ／ ${title}`; container.append(crop) }
    if (model.id === 'kohako-full-v3') for (const [file, title] of [['kohako-full-v3-eyes-crops.jpg', '目元'], ['kohako-full-v3-mouth-crops.jpg', '口元'], ['kohako-full-v3-hair-arms-crops.jpg', '髪・腕'], ['kohako-full-v3-feet-crops.jpg', '足元']]) { const crop = document.createElement('a'); crop.href = `./kohako/live2d/compare/${file}`; crop.textContent = ` ／ ${title}`; container.append(crop) }
  }
  if (model.id === LATEST_MODEL_ID && !lost) {
    // TD-23: 配備版を実ブラウザで録画し、同じ動きの旧新を横に並べた動画（時刻・角度を焼き込み）。髪の肩線の段差・折れが動作中にどう見えるか。
    // v27: 配備ページで v25 と同じ自然動作を録画し横並び（未配備候補は OVERRIDE_P2LRT で差し替えて同位相にした）。
    // v30: v29 の左肩当て上端の白い欠片を修正。配備ページで v29 と同じ動きを録画し横並び（未配備の v30 は OVERRIDE_P2LRT で差し替え）。
    const v30 = document.createElement('p'); v30.textContent = 'v30 の動作比較（v29 / v30）: '
    for (const [file, label] of [['kohako-v30-nat-left-vs-v29.mp4', '考え中の左肩（2 倍スロー）'], ['kohako-v30-nat-left.jpg', '考え中の左肩当て上端（時系列・拡大）'], ['kohako-v30-det-full.jpg', '大きな首振りの全体（退行確認）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v30.append(link, ' ／ ')
    }
    container.append(v30)
    // v35: 後ろ髪の層の房の間の細い切れ目を埋め、左肩上の点線を解消。配備ページで v30 と同じ動きを録画し比較（未配備の v35 は OVERRIDE_P2LRT）。
    const v35 = document.createElement('p'); v35.textContent = 'v35 の動作比較（v30 / v35）: '
    for (const [file, label] of [['kohako-v35-nat-left-vs-v30.mp4', '考え中の左肩（2 倍スロー）'], ['kohako-v35-nat-left.jpg', '考え中の左肩の点線（時系列・拡大）'], ['kohako-v35-nat-right.jpg', '考え中の右肩（退行確認）'], ['kohako-v35-det-full.jpg', '大きな首振りの全体（退行確認）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v35.append(link, ' ／ ')
    }
    container.append(v35)
    // v38: 体の層に残っていた髪の欠片を除去（首の傾きで右肩外側に見えていた）。髪の動きは本人受入済みの v37 と同じ。
    const v38 = document.createElement('p'); v38.textContent = 'v38 の比較（上 v37 / 下 v38）: '
    for (const [file, label] of [['kohako-v38-shoulder-vs-v37.jpg', '右肩の外側（静止・首の傾き ±30・首振り+傾き）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v38.append(link, ' ／ ')
    }
    container.append(v38)
    // v37: 体の層に残っていた頭の髪を後ろ髪へ移した。v36 と同じページ・同じ軌道で、顔だけ／顔固定で髪・呼吸・体だけ／通常動作を録画（未配備の v37 は OVERRIDE_P2LRT）。
    const v37 = document.createElement('p'); v37.textContent = 'v37 の動作比較（v36 / v37、点=実際の頂点、白丸=顔または体に付いて動いた場合の位置）: '
    for (const [file, label] of [['kohako-v37-cause-v36-layers.jpg', '原因: v36 の体の層だけ／後ろ髪の層だけの描画'], ['kohako-v37-A-vs-v36.mp4', 'A 顔だけ動かす（左右・上下・傾き）'], ['kohako-v37-B-vs-v36.mp4', 'B 顔を固定し髪の物理・呼吸・体の回転だけ'], ['kohako-v37-C-vs-v36.mp4', 'C 通常の待機・考え中・発話'], ['kohako-v37-tilt-vs-v36.jpg', '首の傾き（静止）'], ['kohako-v37-thinking-vs-v36.jpg', '考え中の首振り（静止）'], ['kohako-v37-bodyx-vs-v36.jpg', '体の回転 −10 / 0 / +10（上 v36・下 v37）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v37.append(link, ' ／ ')
    }
    container.append(v37)
    // v36: 後ろ髪の根元を頭に、肩より下を体に追従させ、物理の振れ幅を下げた。v35 と同じページ・同じ動きで録画し比較（未配備の v36 は OVERRIDE_P2LRT）。
    const v36 = document.createElement('p'); v36.textContent = 'v36 の動作比較（v35 / v36）: '
    for (const [file, label] of [['kohako-v36-nat-vs-v35.mp4', '待機・考え中・発話・失敗の全体（等速）'], ['kohako-v36-thinking-left-vs-v35.mp4', '考え中の左肩（2 倍スロー）'], ['kohako-v36-nat-right.jpg', '待機の首振りの右側（時系列）'], ['kohako-v36-thinking-left.jpg', '考え中の左肩（時系列）'], ['kohako-v36-det-vs-v35.mp4', '大きな首振り（決定論の軌道）'], ['kohako-v36-det-full.jpg', '大きな首振りの全体（時系列）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v36.append(link, ' ／ ')
    }
    container.append(v36)
    // v29: 長い髪を体から分離。配備ページで v27 と同じ動きを録画し横並び（未配備の v29 は OVERRIDE_P2LRT で差し替え）。
    const v29 = document.createElement('p'); v29.textContent = 'v29 の動作比較（v27 / v29）: '
    for (const [file, label] of [['kohako-v29-nat-vs-v27.mp4', '待機→考え中→話す→首振り 23 秒'], ['kohako-v29-nat-shoulders.jpg', '考え中の左右の肩（時系列）'], ['kohako-v29-det-vs-v27.mp4', '大きな首振り（X±30・上下）15 秒'], ['kohako-v29-det-left.jpg', '大きな首振りの左肩'], ['kohako-v29-nat-full.jpg', '全体（時系列）'], ['kohako-v29-poses.jpg', '静止 9 ポーズ'], ['kohako-v29-hair-layer.jpg', '体から切り離した髪だけ（衣装の混入なしの確認）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v29.append(link, ' ／ ')
    }
    container.append(v29)
    const v27 = document.createElement('p'); v27.textContent = 'v27 の動作比較（v25 / v27）: '
    for (const [file, label] of [['kohako-v27-nat-vs-v25.mp4', '待機→考え中→話す→首振り 23 秒'], ['kohako-v27-nat-sheet.jpg', '考え中の時系列'], ['kohako-v27-det.mp4', '大きな首振り（X±30・上下）15 秒'], ['kohako-v27-shoulder.jpg', '肩の拡大（静止 11 ポーズ）'], ['kohako-v27-full.jpg', '全体（静止 11 ポーズ）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${file}`; link.textContent = label; v27.append(link, ' ／ ')
    }
    container.append(v27)
    const videos = document.createElement('p'); videos.textContent = '動作の比較動画（v25 / v24、同じ parameter 軌道）: '
    for (const [file, label] of [['det-v25-vs-v24', '首振り・上下・髪揺れ・まばたき 15 秒'], ['det-x-slow3x-v25-vs-v24', '左右首振りの肩まわり 1/3 倍速'], ['nat-v25-vs-v24', '待機→考え中→話す→首振り 23 秒']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/kohako-td23-${file}.mp4`; link.textContent = label; videos.append(link, ' ／ ')
    }
    for (const [file, label] of [['det-x-rightshoulder', '右肩の拡大（X±25°）'], ['det-x-shoulders', '肩まわり（X 掃引）'], ['nat-thinking-right', '考え中の右肩（時系列）']]) {
      const link = document.createElement('a'); link.href = `./kohako/live2d/compare/kohako-td23-${file}.jpg`; link.textContent = label; videos.append(link, ' ／ ')
    }
    container.append(videos)
    for (const [file, label] of [['mouth', 'v24/v25 口 0〜1'], ['full', 'v24/v25 全体']]) {
      const comparison = document.createElement('a')
      comparison.href = `./kohako/live2d/compare/kohako-v25-vs-v24-${file}.jpg`
      comparison.textContent = label
      container.append(comparison, ' ／ ')
    }
    for (const [file, label] of [['ornament', 'v23/v24 髪飾りの下地（首振り複合）'], ['mouth', 'v23/v24 口 0〜1'], ['eyes', 'v23/v24 目 1〜0'], ['full', 'v23/v24 全体（9 ポーズ）']]) {
      const comparison = document.createElement('a')
      comparison.href = `./kohako/live2d/compare/kohako-v24-vs-v23-${file}.jpg`
      comparison.textContent = label
      container.append(comparison, ' ／ ')
    }
    for (const [file, label] of [['full', 'v17/v23 髪の比較（9 ポーズ）'], ['band', 'v17/v23 肩まわり拡大（首振り）'], ['zoom', 'v17/v23 肩まわり切出し']]) {
      const comparison = document.createElement('a')
      comparison.href = `./kohako/live2d/compare/kohako-v23-vs-v17-${file}.jpg`
      comparison.textContent = label
      container.append(comparison, ' ／ ')
    }
    const link = document.createElement('a'); link.href = './kohako/live2d/compare/kohako-v13-hair-shift-web.png'; link.textContent = '髪のずれ 修正前後の比較（実ブラウザ）'; const link2 = document.createElement('a'); link2.href = './kohako/live2d/compare/kohako-v14-compare-hair.jpg'; link2.textContent = 'v13・v14 静止／角度別の比較'; const mask = document.createElement('a'); mask.href = './kohako/live2d/compare/kohako-v14-exposure-mask.jpg'; mask.textContent = '後ろ髪の露出領域'; const shake = document.createElement('a'); shake.href = './kohako/live2d/compare/kohako-v14-shake.gif'; shake.textContent = '首振りの静止3点を往復'; const v15 = document.createElement('a'); v15.href = './kohako/live2d/compare/kohako-v15-compare-hair.jpg'; v15.textContent = 'v15 髪の角度別比較'; const v15mask = document.createElement('a'); v15mask.href = './kohako/live2d/compare/kohako-v15-mask.jpg'; v15mask.textContent = 'v15 移動範囲'; const v15shake = document.createElement('a'); v15shake.href = './kohako/live2d/compare/kohako-v15-shake.gif'; v15shake.textContent = 'v15 首振り'; const detail = document.createElement('a'); detail.href = './kohako/live2d/compare/kohako-v15-compare-xminus20.jpg'; detail.textContent = 'X−20 拡大'; const eyes = document.createElement('a'); eyes.href = './kohako/live2d/compare/kohako-v15e-compare-eyes.jpg'; eyes.textContent = 'v15e 閉眼の比較'; const v16eyes = document.createElement('a'); v16eyes.href = './kohako/live2d/compare/kohako-v16-compare-eyes.jpg'; v16eyes.textContent = 'v16 目の比較'; const v16mouth = document.createElement('a'); v16mouth.href = './kohako/live2d/compare/kohako-v16-compare-mouth.jpg'; v16mouth.textContent = 'v16 口の比較'; const v16full = document.createElement('a'); v16full.href = './kohako/live2d/compare/kohako-v16-compare-full.jpg'; v16full.textContent = 'v16 全体の比較'; const v17eyes = document.createElement('a'); v17eyes.href = './kohako/live2d/compare/kohako-v17-compare-eyes.jpg'; v17eyes.textContent = 'v17 目の比較'; const v17mouth = document.createElement('a'); v17mouth.href = './kohako/live2d/compare/kohako-v17-compare-mouth.jpg'; v17mouth.textContent = 'v17 口の比較'; const v17full = document.createElement('a'); v17full.href = './kohako/live2d/compare/kohako-v17-compare-full.jpg'; v17full.textContent = 'v17 全体の比較'; const v19mouth = document.createElement('a'); v19mouth.href = './kohako/live2d/compare/kohako-v19-compare-mouth.jpg'; v19mouth.textContent = 'v19 最終の口比較'; const v19full = document.createElement('a'); v19full.href = './kohako/live2d/compare/kohako-v19-compare-full.jpg'; v19full.textContent = 'v19 最終の全体比較'; const v19trial = document.createElement('a'); v19trial.href = './kohako/live2d/compare/kohako-v19-trial2-mouth.jpg'; v19trial.textContent = 'v19 変形案の比較'; const v20material = document.createElement('a'); v20material.href = './kohako/live2d/compare/kohako-v20-material.jpg'; v20material.textContent = 'v20 口素材の比較'; const v21material = document.createElement('a'); v21material.href = './kohako/live2d/compare/kohako-v21-material.jpg'; v21material.textContent = 'v21 口素材の比較'; container.append(v21material, ' ／ ', v20material, ' ／ ', v19mouth, ' ／ ', v19full, ' ／ ', v19trial, ' ／ ', v17eyes, ' ／ ', v17mouth, ' ／ ', v17full, ' ／ ', v16eyes, ' ／ ', v16mouth, ' ／ ', v16full, ' ／ ', link, ' ／ ', link2, ' ／ ', mask, ' ／ ', shake, ' ／ ', v15, ' ／ ', v15mask, ' ／ ', v15shake, ' ／ ', detail, ' ／ ', eyes)
  }
  if (lost) {
    const note = document.createElement('p'); note.textContent = lost.note ?? 'p2lrt は作業ディレクトリ消失により未保存・再現不能です。比較画像を表示します。'; container.append(note)
    if (lost.id === 'kohako-v45-video' || lost.id === 'kohako-v46-video') {
      for (const [file, text] of [['idle', '待機・等速'], ['blink', '決定論的まばたき・等速'], ['slow', '同じ軌道の 1/5 倍速'], ['det', '口・髪を含む動作比較']]) {
        const link = document.createElement('a'); link.href = `./kohako/live2d/compare/${lost.id.replace('-video', '')}-${file}.mp4`; link.textContent = text; container.append(link, ' ／ ')
      }
    }
    if (lost.id === 'kohako-v28') {
      for (const [file, text] of [['det', '複合首振り 3 秒'], ['nat', '考え中 4 秒']]) {
        const link = document.createElement('a'); link.href = `./kohako/live2d/compare/kohako-v28-probe-${file}.mp4`; link.textContent = text; container.append(link, ' ／ ')
      }
    }
    if (lost.id === 'kohako-v26') {
      for (const [file, text] of [['det', 'v25 / v26 動作比較'], ['shoulder-slow3x', '肩周辺 1/3 倍速']]) {
        const link = document.createElement('a'); link.href = `./kohako/live2d/compare/kohako-v26-${file}.mp4`; link.textContent = text; container.append(link, ' ／ ')
      }
    }
    for (const src of lost.images) { const img = document.createElement('img'); img.src = src; img.alt = `${lost.id} の比較: ${src.split('-compare-')[1]?.replace(/\.(png|jpg)$/, '')}`; img.style.maxWidth = '100%'; img.loading = 'lazy'; container.append(img) }
  }
  return !!lost
}
