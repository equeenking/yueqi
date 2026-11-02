# -*- coding: utf-8 -*-
"""校验模板：notes 顶层键必须是通道名，sends 键必须是总线名或通道条名。"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, 'packages/core/src/templates')
KEY = re.compile(r"\s*(?:'([^']*)'|\"([^\"]*)\"|([\w$\u4e00-\u9fff]+))\s*:")


def depth0_keys(body):
    """返回对象体 body 里第一层的键名。"""
    out = []
    i = 0
    while i < len(body):
        c = body[i]
        if c in ' \t\n,':
            i += 1
            continue
        if c in '\'"`':
            q = c
            i += 1
            while i < len(body) and body[i] != q:
                if body[i] == '\\':
                    i += 1
                i += 1
            i += 1
            continue
        m = KEY.match(body, i)
        if not m:
            i += 1
            continue
        out.append(m.group(1) if m.group(1) is not None else
                   (m.group(2) if m.group(2) is not None else m.group(3)))
        i = m.end()
        # 跳到逗号（跳过嵌套括号里的内容）
        d = 0
        while i < len(body):
            ch = body[i]
            if ch in '\'"`':
                q = ch
                i += 1
                while i < len(body) and body[i] != q:
                    if body[i] == '\\':
                        i += 1
                    i += 1
            elif ch in '([{':
                d += 1
            elif ch in ')]}':
                d -= 1
            elif ch == ',' and d == 0:
                break
            i += 1
    return out


def grab_brace(s, i):
    """s[i] 为 { 或 [，返回配对符号之后的位置与内部文本。"""
    open_c = s[i]
    close_c = {'{': '}', '[': ']'}[open_c]
    d = 0
    j = i
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            q = c
            j += 1
            while j < len(s) and s[j] != q:
                if s[j] == '\\':
                    j += 1
                j += 1
        elif c == open_c:
            d += 1
        elif c == close_c:
            d -= 1
            if d == 0:
                return j + 1, s[i + 1:j]
        j += 1
    return -1, ''


problems = 0
for fn in sorted(os.listdir(TPL)):
    if not fn.endswith('.js') or fn == 'steps.js':
        continue
    p = os.path.join(TPL, fn)
    s = io.open(p, encoding='utf-8').read()

    # 去掉行注释，避免把注释里的英文当键
    s = re.sub(r'(?m)^\s*//.*$', '', s)
    s = re.sub(r'\s//[^\n\'"`]*$', '', s)
    channels = [m.group(1) for m in re.finditer(r"\{\s*name:\s*'([^']+)'\s*,\s*kind:", s)]
    buses = []
    for m in re.finditer(r"buses:\s*\[", s):
        end, body = grab_brace(s, m.end() - 1)
        buses += [mm.group(1) for mm in re.finditer(r"name:\s*'([^']+)'", body)]
    mixnames = set(channels) | set(buses)

    # notes: 顶层键
    for m in re.finditer(r"notes:\s*(?:\([^)]*\)\s*=>\s*)?", s):
        i = m.end()
        while i < len(s) and s[i] in ' \t\n':
            i += 1
        if i >= len(s) or s[i] != '(':
            continue
        j = i + 1
        while j < len(s) and s[j] in ' \t\n':
            j += 1
        if j >= len(s) or s[j] != '{':
            continue
        end, body = grab_brace(s, j)
        for k in depth0_keys(body):
            if k not in channels:
                print('!! %-16s notes 键不存在 %r  可用:%s' % (fn, k, channels))
                problems += 1

    # sends: 顶层键
    for m in re.finditer(r"sends:\s*\{", s):
        end, body = grab_brace(s, m.end() - 1)
        for k in depth0_keys(body):
            if k not in mixnames:
                print('!! %-16s sends 目标不存在 %r  可用:%s' % (fn, k, sorted(mixnames)))
                problems += 1

    for m in re.finditer(r"(pump|sidechain|source)\s*:\s*'([^']+)'", s):
        if m.group(2) not in channels and m.group(2) not in mixnames:
            print('!! %-16s %s 指向不存在 %r' % (fn, m.group(1), m.group(2)))
            problems += 1

print('问题数', problems)
sys.exit(1 if problems else 0)
