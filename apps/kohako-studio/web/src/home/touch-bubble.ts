/** 連続する一時表示の間、直前の本文と保持状態を一度だけ保存する。 */
export class TouchBubble {
  private before: { text: string; retained: boolean } | undefined

  begin(text: string, retained: boolean) {
    this.before ??= { text, retained }
  }

  take() {
    const before = this.before
    this.before = undefined
    return before
  }

  clear() {
    this.before = undefined
  }
}
