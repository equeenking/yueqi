"""健壮的预设键提取：支持单行/多行、引号/裸键（含中文）。"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = re.compile(r"\s*(?:'([^']*)'|\"([^\"]*)\"|([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*))\s*:")


def find_matching(s, i):
    open_c = s[i]
    close_c = {'{': '}', '[': ']'}[open_c]
    d = 0
    while i < len(s):
        c = s[i]
        if c in '\'"`':
            q = c
            i += 1
            while i < len(s) and s[i] != q:
                if s[i] == '\\':
                    i += 1
                i += 1
        elif c == open_c:
            d += 1
        elif c == close_c:
            d -= 1
            if d == 0:
                return i
        i += 1
    return -1


def presets_of(path):
    src = io.open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r"\n  ([a-zA-Z_$][\w$]*)\s*:\s*\{", src):
        kind = m.group(1)
        start = m.end() - 1
        end = find_matching(src, start)
        if end < 0:
            continue
        blk = src[start:end + 1]
        pm = re.search(r"presets\s*:\s*\{", blk)
        if not pm:
            continue
        ps = pm.end() - 1
        pe = find_matching(blk, ps)
        pb = blk[ps + 1:pe]
        names = []
        i = 0
        while i < len(pb):
            c = pb[i]
            if c in ' \t\n,':
                i += 1
                continue
            m2 = KEY.match(pb, i)
            if not m2:
                i += 1
                continue
            names.append(m2.group(1) if m2.group(1) is not None else
                         (m2.group(2) if m2.group(2) is not None else m2.group(3)))
            i = m2.end()
            while i < len(pb) and pb[i] in ' \t\n':
                i += 1
            if i < len(pb) and pb[i] in '{[':
                e = find_matching(pb, i)
                i = (e + 1) if e > 0 else len(pb)
            else:
                while i < len(pb) and pb[i] not in ',':
                    i += 1
        out[kind] = names
    return out


if __name__ == '__main__':
    en = presets_of(os.path.join(ROOT, 'scripts/backup/instruments.js.en'))
    zh = presets_of(os.path.join(ROOT, 'packages/core/src/instruments.js'))
    mapping = {}
    bad = []
    for k in en:
        a, b = en[k], zh.get(k, [])
        if not a or not b:
            continue
        if len(a) != len(b):
            bad.append((k, a, b))
            continue
        for x, y in zip(a, b):
            if x != y:
                mapping[x] = y
    print('映射', len(mapping), '条；数量不符', len(bad), '种')
    for k, a, b in bad:
        print('  !!', k, len(a), '=', a)
        print('     ', k, len(b), '=', b)
    json.dump(mapping, io.open(os.path.join(ROOT, 'scripts/preset_alias.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, sort_keys=True)

    tpl = os.path.join(ROOT, 'packages/core/src/templates')
    n = 0
    for fn in sorted(os.listdir(tpl)):
        if not fn.endswith('.js'):
            continue
        p = os.path.join(tpl, fn)
        src = io.open(p, encoding='utf-8').read()
        orig = src
        for a, b in mapping.items():
            src = re.sub(r"(preset:\s*)'%s'" % re.escape(a), lambda m, b=b: m.group(1) + "'" + b + "'", src)
        if src != orig:
            io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
            n += 1
    print('修补模板', n)
