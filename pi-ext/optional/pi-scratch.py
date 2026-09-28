#!/usr/bin/env python3
"""Opt-in scratch helper. Install at ~/.pi/agent/bin/pi-scratch.py (Python 3.11+, POSIX).

Only cleans named jobs under a private scratch root, never arbitrary temp paths.
Uses fd-relative, symlink-resistant deletion, not shell parsing or an rm exemption.
This is an accident guard, not isolation from other processes running as you.
"""
import os
import re
import shutil
import stat
import sys
import uuid


def main(args):
    if sys.version_info < (3, 11) or not shutil.rmtree.avoids_symlink_attacks:
        raise ValueError("Requires Python 3.11+ with symlink-resistant rmtree")
    if args != ["create"] and not (len(args) == 2 and args[0] == "clean"):
        raise ValueError("Usage: pi-scratch.py create | clean <returned-directory>")
    root = os.path.join(os.path.expanduser("~"), ".pi", "agent", "scratch")
    if args[0] == "create":
        os.makedirs(root, mode=0o700, exist_ok=True)
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError("Scratch root must be owned by you with permissions 0700")
        if args[0] == "create":
            name = "job-" + uuid.uuid4().hex
            os.mkdir(name, mode=0o700, dir_fd=fd)
            print(os.path.join(root, name))
            return
        parent, name = os.path.split(args[1])
        if parent != root or not re.fullmatch(r"job-[0-9a-f]{32}", name):
            raise ValueError("Refusing cleanup outside a named scratch job")
        try:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return  # Repeating cleanup is harmless, but still validates the path.
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError("Scratch job must be a directory owned by you, not a symlink")
        shutil.rmtree(name, dir_fd=fd)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError) as error:
        print(f"pi-scratch: {error}", file=sys.stderr)
        sys.exit(1)
