#!/usr/bin/env python3
"""Drive an interactive program in a pseudo-terminal and render its screen.

Minimal VT100/xterm emulator: enough for Ink-style TUIs (cursor moves, line and
screen erase, scrolling). Usage: tui.py OUT_PREFIX -- command args...
Answers prompts via a small script of (wait_for_text, keys) steps.
"""
import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time
import unicodedata

COLS, ROWS = int(os.environ.get('TUI_COLS', 110)), int(os.environ.get('TUI_ROWS', 46))


class Screen:
    def __init__(self, cols, rows):
        self.cols, self.rows = cols, rows
        self.grid = [[" "] * cols for _ in range(rows)]
        self.x = self.y = 0
        self.saved = (0, 0)
        self.buf = ""

    def scroll_up(self, n=1):
        for _ in range(n):
            self.grid.pop(0)
            self.grid.append([" "] * self.cols)

    def newline(self):
        self.y += 1
        if self.y >= self.rows:
            self.scroll_up()
            self.y = self.rows - 1

    def put(self, ch):
        w = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if unicodedata.combining(ch):
            return
        if self.x + w > self.cols:
            self.x = 0
            self.newline()
        self.grid[self.y][self.x] = ch
        if w == 2 and self.x + 1 < self.cols:
            self.grid[self.y][self.x + 1] = ""
        self.x += w

    def feed(self, data):
        s = self.buf + data
        self.buf = ""
        i, n = 0, len(s)
        while i < n:
            c = s[i]
            if c == "\x1b":
                if i + 1 >= n:
                    self.buf = s[i:]
                    return
                nxt = s[i + 1]
                if nxt == "[":
                    m = re.match(r"\x1b\[([<=>?]?)([0-9;:]*)([ -/]*)([@-~])", s[i:])
                    if not m:
                        if len(s) - i < 32:
                            self.buf = s[i:]
                            return
                        i += 2
                        continue
                    self.csi(m.group(1), m.group(2), m.group(4))
                    i += m.end()
                    continue
                if nxt == "]":
                    j = s.find("\x07", i)
                    k = s.find("\x1b\\", i)
                    ends = [e for e in (j, k) if e >= 0]
                    if not ends:
                        self.buf = s[i:]
                        return
                    e = min(ends)
                    i = e + (1 if e == j else 2)
                    continue
                if nxt == "7":
                    self.saved = (self.x, self.y)
                elif nxt == "8":
                    self.x, self.y = self.saved
                elif nxt == "M":
                    self.y = max(0, self.y - 1)
                i += 2 if nxt not in "()#%" else 3
                continue
            if c == "\r":
                self.x = 0
            elif c == "\n":
                self.newline()
            elif c == "\b":
                self.x = max(0, self.x - 1)
            elif c == "\t":
                self.x = min(self.cols - 1, (self.x // 8 + 1) * 8)
            elif c == "\x07" or ord(c) < 32:
                pass
            else:
                self.put(c)
            i += 1

    def csi(self, priv, params, final):
        if priv in "<=>?" and priv:
            return
        nums = [int(p) if p.isdigit() else 0 for p in params.replace(":", ";").split(";")] \
            if params else []
        a = nums[0] if nums else 0
        one = a or 1
        if final == "A":
            self.y = max(0, self.y - one)
        elif final == "B":
            self.y = min(self.rows - 1, self.y + one)
        elif final == "C":
            self.x = min(self.cols - 1, self.x + one)
        elif final == "D":
            self.x = max(0, self.x - one)
        elif final == "E":
            self.y = min(self.rows - 1, self.y + one); self.x = 0
        elif final == "F":
            self.y = max(0, self.y - one); self.x = 0
        elif final == "G":
            self.x = min(self.cols - 1, one - 1)
        elif final == "d":
            self.y = min(self.rows - 1, one - 1)
        elif final in "Hf":
            r = (nums[0] if nums and nums[0] else 1) - 1
            col = (nums[1] if len(nums) > 1 and nums[1] else 1) - 1
            self.y, self.x = min(self.rows - 1, r), min(self.cols - 1, col)
        elif final == "J":
            if a == 0:
                self.grid[self.y][self.x:] = [" "] * (self.cols - self.x)
                for r in range(self.y + 1, self.rows):
                    self.grid[r] = [" "] * self.cols
            elif a == 1:
                for r in range(0, self.y):
                    self.grid[r] = [" "] * self.cols
                self.grid[self.y][:self.x + 1] = [" "] * (self.x + 1)
            else:
                self.grid = [[" "] * self.cols for _ in range(self.rows)]
        elif final == "K":
            row = self.grid[self.y]
            if a == 0:
                row[self.x:] = [" "] * (self.cols - self.x)
            elif a == 1:
                row[:self.x + 1] = [" "] * (self.x + 1)
            else:
                self.grid[self.y] = [" "] * self.cols
        elif final == "X":
            for k in range(self.x, min(self.cols, self.x + one)):
                self.grid[self.y][k] = " "
        elif final == "P":
            row = self.grid[self.y]
            del row[self.x:self.x + one]
            row.extend([" "] * (self.cols - len(row)))
        elif final == "@":
            row = self.grid[self.y]
            for _ in range(one):
                row.insert(self.x, " ")
            del row[self.cols:]
        elif final == "L":
            for _ in range(one):
                self.grid.insert(self.y, [" "] * self.cols)
                self.grid.pop()
        elif final == "M":
            for _ in range(one):
                self.grid.pop(self.y)
                self.grid.append([" "] * self.cols)
        elif final == "S":
            self.scroll_up(one)
        elif final == "s":
            self.saved = (self.x, self.y)
        elif final == "u":
            self.x, self.y = self.saved

    def text(self):
        lines = ["".join(r).rstrip() for r in self.grid]
        while lines and not lines[-1]:
            lines.pop()
        return "\n".join(lines)


def run(out_prefix, argv, steps, total=120):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    scr = Screen(COLS, ROWS)
    import codecs
    dec = codecs.getincrementaldecoder('utf-8')('replace')
    raw = open(out_prefix + ".raw", "wb")
    t0 = time.time()
    step = 0
    shots = 0
    last_change = time.time()
    while time.time() - t0 < total:
        r, _, _ = select.select([fd], [], [], 0.3)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            raw.write(data)
            scr.feed(dec.decode(data))
            last_change = time.time()
        if step < len(steps):
            wait_for, keys, label = steps[step]
            screen = scr.text()
            if wait_for in screen and time.time() - last_change > 1.5:
                if label:
                    shots += 1
                    with open("%s.%s.txt" % (out_prefix, label), "w") as fh:
                        fh.write(screen)
                    print("=== screen: %s ===" % label)
                    print(screen)
                if keys:
                    os.write(fd, keys.encode())
                step += 1
                last_change = time.time()
        elif time.time() - last_change > 3:
            break
    with open(out_prefix + ".final.txt", "w") as fh:
        fh.write(scr.text())
    try:
        os.kill(pid, 9)
    except OSError:
        pass
    return scr.text()


if __name__ == "__main__":
    out = sys.argv[1]
    argv = sys.argv[sys.argv.index("--") + 1:]
    steps_env = os.environ.get("TUI_STEPS", "")
    steps = []
    for part in steps_env.split("||"):
        if not part.strip():
            continue
        wait_for, keys, label = part.split("::")
        keys = keys.encode().decode("unicode_escape")
        steps.append((wait_for, keys, label))
    final = run(out, argv, steps, total=int(os.environ.get("TUI_TOTAL", "120")))
    if not steps:
        print(final)
