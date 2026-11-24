"""Build the Screen Time research PDF.

Prints the HTML parts with headless Chrome, finds the page each section starts on,
writes those numbers into the contents, links citations to the reference list,
and prints again. Needs macOS (Chrome + a small PDFKit helper, see PDFTOOL).

    python3 build.py ../TrueLine-Screen-Time-Research.pdf
"""
import os, re, subprocess, sys, pathlib

S = pathlib.Path(__file__).parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PDFTOOL = os.environ.get("PDFTOOL", "pdftool")
OUT = pathlib.Path(sys.argv[1]).resolve()
src = "".join(p.read_text() for p in sorted(S.glob("part*.html")))


def norm(t):
    t = re.sub(r'<span class="num">.*?</span>', "", t)
    t = re.sub(r'<span class="tag[^"]*">.*?</span>', "", t)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)).replace("&amp;", "&").replace("&nbsp;", " ").strip()


def linkify(h):
    """Citation numbers link to their reference; reference URLs become links."""
    h = re.sub(r'<sup class="ref">((?:\[\d+\])+)</sup>',
               lambda m: '<sup class="ref">' + re.sub(r"\[(\d+)\]", r'<a href="#ref-\1">[\1]</a>', m.group(1)) + "</sup>", h)
    head, refs = h.split('<h2 id="refs" class="flow">', 1)

    def block(m):
        n = [int(m.group(1) or 1) - 1]

        def li(mm):
            n[0] += 1
            body = re.sub(r"(https?://\S+?)(?=</li>|\s|$)", r'<a href="\1">\1</a>', mm.group(1))
            return f'<li id="ref-{n[0]}">{body}</li>'

        return m.group(0).split(">", 1)[0] + ">" + re.sub(r"<li>(.*?)</li>", li, m.group(2), flags=re.S) + "</ol>"

    refs = re.sub(r'<ol class="refs"(?: start="(\d+)")?>(.*?)</ol>', block, refs, flags=re.S)
    return head + '<h2 id="refs" class="flow">' + refs


def pdf(html, out):
    (S / "_print.html").write_text(html)
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    "--virtual-time-budget=4000", f"--print-to-pdf={out}", (S / "_print.html").as_uri()],
                   check=True, capture_output=True)


def pages(out):
    r = subprocess.run([PDFTOOL, "pages", str(out)], capture_output=True, text=True, check=True).stdout
    return [line.split("\t", 1)[1] if "\t" in line else "" for line in r.splitlines()]


src = linkify(src)
heads = re.findall(r'<h([23]) id="([^"]+)"[^>]*>(.*?)</h\1>', src, re.S)
tmp = S / "_pass1.pdf"
html, found = src, {}
for _ in range(2):
    pdf(html, tmp)
    texts = pages(tmp)
    toc_end = next((i for i, t in enumerate(texts) if "Executive summary" in t and "Contents" not in t), 2)
    found = {}
    for _lvl, hid, title in heads:
        key = norm(title).replace(" ", "")[:50]
        for i in range(toc_end, len(texts)):
            if key in texts[i].replace(" ", ""):
                found[hid] = i + 1
                break
    html = src
    for hid, pg in found.items():
        html = html.replace(f'data-page="{hid}"></span>', f'data-page="{hid}">{pg}</span>')
pdf(html, OUT)
toc = set(re.findall(r'data-page="([^"]+)"', src))
print(f"pages={len(pages(OUT))} toc-missing={sorted(toc - set(found))}")
for f in ("_print.html", "_pass1.pdf"):
    (S / f).unlink(missing_ok=True)
