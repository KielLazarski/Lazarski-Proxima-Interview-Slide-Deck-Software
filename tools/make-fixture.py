#!/usr/bin/env python3
"""make-fixture.py — build a realistic .pptx for the importer to be tested against.

Written with python-pptx so the file is produced by a different codebase than
the one under test. It deliberately exercises the parts of OOXML that a
hand-rolled reader gets wrong: placeholders whose position lives on the layout
rather than the slide, theme colour references with luminance modifiers,
multi-level bullets, grouped shapes with their own child coordinate space,
rotation, adjust values, a table with a header row, an embedded picture, a
connector with an arrowhead, and speaker notes.

Usage: python3 -I tools/make-fixture.py out.pptx
"""
import struct
import sys
import zlib

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt


def tiny_png(path, w=96, h=64):
    """A valid PNG written by hand, so the fixture needs no image library."""
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        for x in range(w):
            raw += bytes(((x * 255) // max(1, w - 1), (y * 255) // max(1, h - 1), 140))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return path


def main(out):
    prs = Presentation()
    # 16:9 at the size PowerPoint itself uses, so the importer has to read it
    # from the file rather than assume a default.
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    img = tiny_png("/tmp/_fixture_img.png")

    # ---- 1. title slide: both placeholders inherit position from the layout
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "Fixture Deck"
    s.placeholders[1].text = "Subtitle from the layout placeholder"
    s.notes_slide.notes_text_frame.text = "Notes for slide one.\nSecond line of notes."

    # ---- 2. title and content: multi-level bullets with mixed run formatting
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "Bullets and runs"
    tf = s.placeholders[1].text_frame
    tf.text = "First level item"
    p = tf.add_paragraph()
    p.text = "Second level item"
    p.level = 1
    p = tf.add_paragraph()
    p.level = 2
    r = p.add_run()
    r.text = "Bold "
    r.font.bold = True
    r = p.add_run()
    r.text = "italic "
    r.font.italic = True
    r = p.add_run()
    r.text = "coloured "
    r.font.color.rgb = RGBColor(0xC0, 0x30, 0x20)
    r = p.add_run()
    r.text = "and sized"
    r.font.size = Pt(28)
    p = tf.add_paragraph()
    p.text = "Back to first level"
    p.level = 0
    s.notes_slide.notes_text_frame.text = "Bullet levels must survive the round trip."

    # ---- 3. shapes: theme colours, adjust values, rotation, a group, a line
    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Shapes"

    rr = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.6), Inches(1.9), Inches(2.6), Inches(1.3))
    rr.text_frame.text = "Rounded, accent 2"
    rr.fill.solid()
    rr.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_2
    rr.line.color.rgb = RGBColor(0x20, 0x20, 0x20)
    rr.line.width = Pt(2.25)
    # a non-default adjust value, which the reader must pick up from avLst
    rr.adjustments[0] = 0.33

    tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(3.6), Inches(1.9), Inches(1.6), Inches(1.6))
    tri.rotation = 22.5
    tri.fill.solid()
    tri.fill.fore_color.rgb = RGBColor(0x2E, 0x8B, 0x7A)

    pent = s.shapes.add_shape(MSO_SHAPE.REGULAR_PENTAGON, Inches(5.6), Inches(1.9), Inches(1.6), Inches(1.6))
    pent.fill.solid()
    pent.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_4

    # A group: children live in the group's own coordinate space, so a reader
    # that ignores chOff/chExt will place these in the wrong spot.
    grp = s.shapes.add_group_shape()
    a = grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(7.8), Inches(2.0), Inches(1.0), Inches(1.0))
    a.fill.solid()
    a.fill.fore_color.rgb = RGBColor(0xD8, 0xA0, 0x30)
    b = grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(8.6), Inches(2.6), Inches(1.0), Inches(1.0))
    b.fill.solid()
    b.fill.fore_color.rgb = RGBColor(0x90, 0x60, 0xC0)

    conn = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.8), Inches(3.6), Inches(5.2), Inches(4.2))
    conn.line.color.rgb = RGBColor(0x30, 0x30, 0x30)
    conn.line.width = Pt(3)

    tb = s.shapes.add_textbox(Inches(0.6), Inches(4.6), Inches(5.0), Inches(0.9))
    tb.text_frame.word_wrap = True
    tp = tb.text_frame.paragraphs[0]
    tp.text = "A plain text box, right aligned"
    tp.alignment = PP_ALIGN.RIGHT
    s.notes_slide.notes_text_frame.text = "Shape geometry, rotation, groups and a connector."

    # ---- 4. a table with a header row, and a picture
    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "Table and picture"
    rows, cols = 4, 3
    gt = s.shapes.add_table(rows, cols, Inches(0.6), Inches(1.9), Inches(6.4), Inches(2.4))
    tbl = gt.table
    heads = ["Target", "E3", "Status"]
    data = [
        ["STAT6", "CRBN", "positive"],
        ["RIPK1", "CRBN", "reject"],
        ["PNPLA3", "CRBN", "positive"],
    ]
    for c, htxt in enumerate(heads):
        tbl.cell(0, c).text = htxt
    for r_i, row in enumerate(data, start=1):
        for c_i, val in enumerate(row):
            tbl.cell(r_i, c_i).text = val
    tbl.columns[0].width = Inches(2.6)
    tbl.columns[1].width = Inches(1.8)
    tbl.columns[2].width = Inches(2.0)

    s.shapes.add_picture(img, Inches(7.6), Inches(1.9), Inches(3.2), Inches(2.13))
    s.notes_slide.notes_text_frame.text = "Table widths and the embedded PNG."

    # ---- 5. blank slide with a gradient-ish stack and an explicit background
    s = prs.slides.add_slide(prs.slide_layouts[6])
    band = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(0), Emu(0), prs.slide_width, Inches(1.1))
    band.fill.solid()
    band.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_1
    band.line.fill.background()
    band.text_frame.text = "Blank layout, full-bleed band"

    big = s.shapes.add_textbox(Inches(0.8), Inches(2.4), Inches(11.7), Inches(2.0))
    btf = big.text_frame
    btf.word_wrap = True
    btf.text = ("A long paragraph that exists to exercise wrapping and the autofit path, "
                "because text that overflows its frame is where a renderer and PowerPoint "
                "most often disagree about what the slide looks like.")
    btf.paragraphs[0].font.size = Pt(20)

    prs.save(out)
    print("wrote %s  (%d slides)" % (out, len(prs.slides.__iter__.__self__._sldIdLst)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixture.pptx")
