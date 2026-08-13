# codex ARMv7 クロスビルド修正計画（反復 2）

1. v8 crate 150.4.0 の rusty_v8 FFI と V8 cppgc allocator の alignment 制約を照合する。
2. 32bit ターゲットで未サポートの 16-byte alignment 用テンプレートが実体化されないよう、workflow で rusty_v8 を自動変換する。
3. Rust 側の cppgc alignment 上限も V8 の `2 * sizeof(void*)` と一致させ、将来の過大 alignment 利用をコンパイル時に防ぐ。
4. actionlint（shellcheck 統合）と ghalint で workflow を検証し、差分をセルフレビューする。
