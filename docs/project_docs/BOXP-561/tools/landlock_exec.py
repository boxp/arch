#!/usr/bin/env python3
# BOXP-561 長時間評価: 本番 vault への読み書きを Linux Landlock でカーネルレベルに遮断してコマンドを実行する。
# usage: landlock_exec.py PROTECTED_DIR -- CMD [ARGS...]
# 文字列照合（vaultguard.ts）は変数展開・スクリプト経由で回避できるため、こちらを一次防御とする。
# Landlock は許可リスト方式なので、ルート (/) から PROTECTED_DIR までの各祖先ディレクトリについて
# 「経路上の子以外の全エントリ」に全権限を付け、経路上のディレクトリ自体には何も付けない。
# 兄弟のシンボリックリンクには規則を付けない。既存のハードリンクは対象外（評価前後の guard.bb digest 照合で検出する）。
# 結果として PROTECTED_DIR 配下（シンボリックリンク経由を含む）と祖先ディレクトリの一覧取得は拒否され、それ以外は従来通り使える。
# Landlock が使えない・ルール設定に失敗した場合は実行せず exit 126（fail closed）。
# ctypes で syscall を直接呼ぶ必要があるため、bb / shell ではなく Python で書いている（同ディレクトリ relay.py と同様の例外）。
import ctypes
import os
import struct
import sys

SYS_CREATE_RULESET, SYS_ADD_RULE, SYS_RESTRICT_SELF = 444, 445, 446
LANDLOCK_CREATE_RULESET_VERSION = 1
LANDLOCK_RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

EXECUTE, WRITE_FILE, READ_FILE, READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
FILE_RIGHTS_V1 = EXECUTE | WRITE_FILE | READ_FILE
REFER, TRUNCATE = 1 << 13, 1 << 14


class RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64)]


def path_beneath_attr(allowed, fd):
    # struct landlock_path_beneath_attr は packed（u64 + s32 = 12 byte）
    return ctypes.create_string_buffer(struct.pack("<Qi", allowed, fd), 12)


def die(msg):
    print(f"landlock_exec: {msg}", file=sys.stderr)
    sys.exit(126)


def main(argv):
    if len(argv) < 4 or argv[2] != "--":
        die("usage: landlock_exec.py PROTECTED_DIR -- CMD [ARGS...]")
    protected = os.path.realpath(argv[1])
    if protected == "/" or not os.path.isdir(protected):
        die(f"protected dir が不正です: {protected}")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    abi = libc.syscall(SYS_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(LANDLOCK_CREATE_RULESET_VERSION))
    if abi < 1:
        die(f"Landlock が使えません (errno={ctypes.get_errno()})")
    handled = (1 << 13) - 1  # ABI1: EXECUTE..MAKE_SYM
    file_rights = FILE_RIGHTS_V1
    if abi >= 2:
        handled |= REFER
    if abi >= 3:
        handled |= TRUNCATE
        file_rights |= TRUNCATE
    attr = RulesetAttr(handled)
    rfd = libc.syscall(SYS_CREATE_RULESET, ctypes.byref(attr), ctypes.c_size_t(ctypes.sizeof(attr)), ctypes.c_uint32(0))
    if rfd < 0:
        die(f"landlock_create_ruleset 失敗 (errno={ctypes.get_errno()})")

    def allow(path):
        # シンボリックリンクには規則を付けない（リンク先＝protected や / に権限が付くのを防ぐ。リンク経由の参照はリンク先の規則で判定される）
        if os.path.islink(path):
            return
        try:
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC | os.O_NOFOLLOW)
        except OSError:
            return  # 消えた・読めないエントリは許可しない（拒否側に倒れる）
        try:
            is_dir = os.path.isdir(f"/proc/self/fd/{fd}")
            rule = path_beneath_attr(handled if is_dir else file_rights, fd)
            if libc.syscall(SYS_ADD_RULE, ctypes.c_int(rfd), ctypes.c_int(LANDLOCK_RULE_PATH_BENEATH), rule, ctypes.c_uint32(0)) != 0:
                die(f"landlock_add_rule 失敗: {path} (errno={ctypes.get_errno()})")
        finally:
            os.close(fd)

    # / から protected までの経路。経路上のディレクトリには規則を付けず、その兄弟エントリにだけ全権限を付ける
    chain = ["/"]
    for part in protected.strip("/").split("/"):
        chain.append(os.path.join(chain[-1], part))
    for parent, child in zip(chain, chain[1:]):
        try:
            names = os.listdir(parent)
        except OSError as e:
            die(f"{parent} を列挙できません: {e}")
        for name in names:
            p = os.path.join(parent, name)
            if p != child:
                allow(p)

    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        die(f"no_new_privs 設定失敗 (errno={ctypes.get_errno()})")
    if libc.syscall(SYS_RESTRICT_SELF, ctypes.c_int(rfd), ctypes.c_uint32(0)) != 0:
        die(f"landlock_restrict_self 失敗 (errno={ctypes.get_errno()})")
    os.close(rfd)
    # 自己確認: protected が実際に読めないことを確かめてから実行する
    try:
        os.listdir(protected)
        die("Landlock 適用後も protected dir を読めたため中止します")
    except PermissionError:
        pass
    os.execvp(argv[3], argv[3:])


if __name__ == "__main__":
    main(sys.argv)
