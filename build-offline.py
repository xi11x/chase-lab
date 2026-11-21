#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 src/ 的游戏代码 + three.js + GLTFLoader + SkeletonUtils + 角色模型(base64)
打包成一个完全离线的单文件 HTML（不访问任何 CDN，双击即玩）。

用法: python3 build-offline.py
产物: index-offline.html
"""
import base64
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
OFF = os.path.join(HERE, "offline")
SRC = os.path.join(HERE, "src")
OUT = os.path.join(HERE, "index-offline.html")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def split_export(src):
    """把结尾的 export{...} 拆出来，返回 (去掉 export 的源码, [(导出名, 本地名), ...])"""
    m = None
    for m in re.finditer(r"export\s*\{", src):
        pass  # 取最后一个
    if not m:
        raise RuntimeError("no export block found")
    start = m.start()
    brace = src.index("{", start)
    end = src.index("}", brace)
    body = src[brace + 1:end]
    pairs = []
    for part in body.split(","):
        part = part.strip()
        if not part:
            continue
        if " as " in part:
            local, exported = [x.strip() for x in part.split(" as ")]
        else:
            local = exported = part
        pairs.append((exported, local))
    cleaned = src[:start] + src[end + 1:]
    return cleaned, pairs


def strip_import(src, module):
    """去掉 from 'three' / 相对路径 的 import 块，返回 (源码, 导入名列表)"""
    pat = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'" + re.escape(module) + r"';\s*$", re.M | re.S)
    m = pat.search(src)
    names = []
    if m:
        names = [x.strip() for x in re.split(r"[,\n]", m.group(1)) if x.strip()]
        src = src[:m.start()] + src[m.end():]
    return src, names


def extract_function(src, name):
    """按大括号配对抽取一个顶层函数"""
    i = src.index("function " + name + "(")
    j = src.index("{", i)
    depth = 0
    k = j
    while k < len(src):
        c = src[k]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return src[i:k + 1]
        k += 1
    raise RuntimeError("unbalanced braces in " + name)


def main():
    three, exports = split_export(read(os.path.join(OFF, "three.module.min.js")))
    three_obj = ",\n".join(
        (n if n == l else f"{n}: {l}") for n, l in exports
    )

    gltf, gltf_imports = strip_import(read(os.path.join(OFF, "GLTFLoader.js")), "three")
    gltf, _ = strip_import(gltf, "../utils/BufferGeometryUtils.js")
    gltf = gltf.replace("export { GLTFLoader };", "")
    bgu = read(os.path.join(OFF, "BufferGeometryUtils.js"))
    to_tri = extract_function(bgu, "toTrianglesDrawMode")
    if "TrianglesDrawMode" not in gltf_imports:
        gltf_imports.append("TrianglesDrawMode")

    skel, skel_imports = strip_import(read(os.path.join(OFF, "SkeletonUtils.js")), "three")
    skel, _ = split_export(skel)

    game = read(os.path.join(SRC, "game.js"))
    for line in (
        "import * as THREE from 'three';",
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
        "import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';",
    ):
        game = game.replace(line + "\n", "")
    game = re.sub(r"^const MODEL_URL = .*$", "", game, flags=re.M)
    game = game.replace(
        "gltf = await new GLTFLoader().loadAsync(MODEL_URL);",
        "gltf = await new Promise((res, rej) => new GLTFLoader().parse(GLB_BUF, '', res, rej));",
    )

    glb_b64 = base64.b64encode(open(os.path.join(OFF, "RobotExpressive.glb"), "rb").read()).decode("ascii")

    css = read(os.path.join(SRC, "style.css"))
    body = read(os.path.join(SRC, "body.html"))

    bundle = f"""
/* ================= 离线包：three.js r160 (MIT) ================= */
const THREE = (() => {{
{three}
return {{
{three_obj}
}};
}})();
/* ================= 离线包：GLTFLoader ================= */
const GLTFLoader = (() => {{
const {{ {", ".join(gltf_imports)} }} = THREE;
{to_tri}
{gltf}
return GLTFLoader;
}})();
/* ================= 离线包：SkeletonUtils ================= */
const skeletonClone = (() => {{
const {{ {", ".join(skel_imports)} }} = THREE;
{skel}
return clone;
}})();
/* ================= 离线包：角色模型 RobotExpressive (CC0) ================= */
const GLB_B64 = "{glb_b64}";
const GLB_BUF = (() => {{
  const bin = atob(GLB_B64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}})();
/* ================= 游戏本体 ================= */
{{
{game}
}}
"""

    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#bfe2ff">
<title>追上去！· 追及问题实验室（离线版）</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='88'%3E%F0%9F%8F%83%3C/text%3E%3C/svg%3E">
<style>
{css}
</style>
</head>
<body>
{body}
<script type="module">
{bundle}
</script>
</body>
</html>
"""

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"built: {OUT}  ({len(html) / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
