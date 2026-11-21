"""Best-effort sentence geometry for the canonical parser text."""

import re
from contextlib import closing

import pypdfium2
from rag_index import Region, Segment

QUOTES = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'"})
BOUNDARY = re.compile(r"""[.!?]+["'\u201d\u2019)]*(?=\s|$)""")


def sentence_spans(text: str):
    start = 0
    for match in BOUNDARY.finditer(text):
        end = match.end()
        if text[start:end].strip():
            yield start, end
        start = end
        while start < len(text) and text[start].isspace():
            start += 1
    if text[start:].strip():
        yield start, len(text)


class Geometry:
    def __init__(self, pdf):
        self.pdf = pdf
        self.pages = {}

    def page(self, number):
        if number not in self.pages:
            self.pages.clear()
            with closing(self.pdf[number - 1]) as page:
                # Keep unsupported coordinate frames on coarse/page fallback.
                if page.get_rotation() or page.get_bbox() != page.get_mediabox():
                    self.pages[number] = None
                    return None
                with closing(page.get_textpage()) as layer:
                    chars = []
                    boxes = []
                    width, height = page.get_size()
                    for index in range(layer.count_chars()):
                        char = layer.get_text_range(index, 1)
                        if not char.strip():
                            continue
                        if len(char) != 1:
                            self.pages[number] = None
                            return None
                        chars.append(char)
                        l, b, r, t = layer.get_charbox(index)
                        boxes.append((l / width, (height - t) / height, r / width, (height - b) / height))
                    self.pages[number] = ("".join(chars), boxes, height, width)
        return self.pages[number]

    def align(self, text, page, region):
        if region is None:
            return {}, 1
        try:
            data = self.page(page)
        except (ValueError, IndexError, RuntimeError, pypdfium2.PdfiumError):
            self.pages[page] = None
            return {}, 1
        if not data:
            return {}, 1
        chars, boxes, height, width = data
        offsets = [i for i, ch in enumerate(text) if not ch.isspace()]
        needle = "".join(text[i] for i in offsets)
        if not needle:
            return {}, height
        if chars.count(needle) != 1:
            chars, needle = chars.translate(QUOTES), needle.translate(QUOTES)
            if chars.count(needle) != 1:
                return {}, height
        start = chars.index(needle)
        matched = dict(zip(offsets, boxes[start:start + len(offsets)]))
        x_pad, y_pad = 4 / width, 4 / height
        if any(not (0 <= l < r <= 1 and 0 <= t < b <= 1
                    and region[0] - x_pad <= l <= r <= region[2] + x_pad
                    and region[1] - y_pad <= t <= b <= region[3] + y_pad)
               for l, t, r, b in matched.values()):
            return {}, height
        return matched, height


def line_boxes(glyphs, start, end, height) -> list[Region]:
    lines = []
    centers = []
    for index in range(start, end):
        if index not in glyphs:
            continue
        l, t, r, b = glyphs[index]
        center = (t + b) / 2
        if not centers or abs(center - centers[-1]) * height > 6:
            centers.append(center)
            lines.append((l, t, r, b))
        else:
            a, c, d, e = lines[-1]
            lines[-1] = (min(a, l), min(c, t), max(d, r), max(e, b))
    return lines if len(lines) <= 8 else []


def fragment_segments(text, sentences, start, end, page, region, glyphs, height):
    segments = []
    for a, b in sentences:
        left, right = max(a, start), min(b, end)
        if left >= right or not text[left:right].strip():
            continue
        rects = line_boxes(glyphs, left, right, height)
        coarse = not rects and left == 0 and right == len(text) and region is not None
        segments.append(Segment(start=left - start, end=right - start, page=page,
                                partial=left != a or right != b,
                                precision="line" if rects else "coarse" if coarse else "page",
                                rects=[region] if coarse else rects))
    return segments if 0 < len(segments) <= 32 else None
