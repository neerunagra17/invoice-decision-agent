"""Generates the PS-1 sample invoices (fictional companies) into samples/. Run from the project root: python3 tools/make_invoices.py
Needs: pip install reportlab pillow, and poppler (pdftoppm) for the scanned one."""
import subprocess, random
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from PIL import Image, ImageFilter, ImageOps

W, H = A4
BUYER = ("Ganga Infra Projects Pvt Ltd", "14/2 Civil Lines, Kanpur, Uttar Pradesh 208001", "09AAACG4821K1ZK")

def inr(x):
    neg = x < 0; x = abs(x); s = f"{x:.2f}"; whole, dec = s.split('.')
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2: parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        whole = ','.join(parts) + ',' + tail
    return ('-' if neg else '') + whole + '.' + dec

def draw_invoice(path, v):
    c = canvas.Canvas(path, pagesize=A4)
    style = v['style']
    accent = {'A': colors.HexColor('#1f4e79'), 'B': colors.HexColor('#7a1f1f'), 'C': colors.HexColor('#1f5f3a'), 'D': colors.black}[style]
    y = H - 50
    # header
    if style in ('A', 'C'):
        c.setFillColor(accent); c.rect(0, H - 90, W, 90, fill=1, stroke=0); c.setFillColor(colors.white)
        c.setFont('Helvetica-Bold', 18); c.drawString(40, H - 45, v['seller'][0])
        c.setFont('Helvetica', 9); c.drawString(40, H - 62, v['seller'][1]); c.drawString(40, H - 75, 'GSTIN: ' + v['seller'][2])
        c.setFont('Helvetica-Bold', 14); c.drawRightString(W - 40, H - 45, v.get('title', 'TAX INVOICE'))
        c.setFillColor(colors.black); y = H - 120
    else:
        c.setFont('Helvetica-Bold', 16); c.drawCentredString(W / 2, y, v.get('title', 'TAX INVOICE')); y -= 26
        c.setFont('Helvetica-Bold', 12); c.drawString(40, y, v['seller'][0]); y -= 14
        c.setFont('Helvetica', 9); c.drawString(40, y, v['seller'][1]); y -= 12; c.drawString(40, y, 'GSTIN/UIN: ' + v['seller'][2]); y -= 22
    if v.get('stamp'):
        c.saveState(); c.setFillColor(colors.HexColor('#c0392b')); c.setFont('Helvetica-Bold', 26); c.translate(W - 175, H - 72); c.rotate(8)
        c.drawString(0, 0, v['stamp']); c.restoreState()
    # meta block
    c.setFont('Helvetica', 9.5)
    meta_x = W - 230
    yy = y
    for k, val in v['meta']:
        c.setFont('Helvetica-Bold', 9.5); c.drawString(meta_x, yy, k)
        c.setFont('Helvetica', 9.5); c.drawString(meta_x + 95, yy, val); yy -= 14
    c.setFont('Helvetica-Bold', 9.5); c.drawString(40, y, v.get('billto_label', 'Bill To:')); y -= 13
    c.setFont('Helvetica', 9.5)
    for line in (BUYER[0], BUYER[1], 'GSTIN: ' + BUYER[2]): c.drawString(40, y, line); y -= 12
    y = min(y, yy) - 18
    # table
    cols = v['cols']  # list of (header, width, align, key)
    x0 = 40
    c.setFillColor(colors.HexColor('#eeeeee') if style != 'D' else colors.white); c.rect(x0, y - 4, sum(w for _, w, _, _ in cols), 16, fill=1, stroke=0)
    c.setFillColor(colors.black); c.setFont('Helvetica-Bold', 8.5)
    x = x0
    for hdr, w, al, _ in cols:
        (c.drawRightString(x + w - 4, y, hdr) if al == 'R' else c.drawString(x + 3, y, hdr)); x += w
    y -= 18; c.setFont('Helvetica', 8.5)
    for i, it in enumerate(v['items'], 1):
        row = dict(it, sno=str(i))
        x = x0
        for hdr, w, al, key in cols:
            val = row.get(key, '')
            (c.drawRightString(x + w - 4, y, val) if al == 'R' else c.drawString(x + 3, y, val)); x += w
        y -= 16
    c.line(x0, y + 8, x0 + sum(w for _, w, _, _ in cols), y + 8); y -= 8
    # totals
    for label, val, bold in v['totals']:
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 9.5)
        c.drawRightString(W - 150, y, label); c.drawRightString(W - 45, y, val); y -= 15
    y -= 10
    c.setFont('Helvetica-Oblique', 8.5)
    for line in v.get('notes', []): c.drawString(40, y, line); y -= 12
    c.setFont('Helvetica', 8.5); c.drawString(40, 70, v.get('bank', ''))
    c.drawRightString(W - 40, 70, 'For ' + v['seller'][0]); c.drawRightString(W - 40, 45, 'Authorised Signatory')
    c.showPage(); c.save()

def scan(pdf_in, pdf_out, seed=7):
    random.seed(seed)
    subprocess.run(['pdftoppm', '-r', '110', '-gray', '-png', '-singlefile', pdf_in, pdf_in[:-4]], check=True)
    im = Image.open(pdf_in[:-4] + '.png').convert('L')
    im = im.rotate(1.3, expand=True, fillcolor=235)
    px = im.load(); w, h = im.size
    for _ in range(int(w * h * 0.004)):
        x, y = random.randrange(w), random.randrange(h); px[x, y] = random.randrange(90, 200)
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im = ImageOps.autocontrast(im, cutoff=1).point(lambda p: min(255, int(p * 0.94 + 14)))
    im.save(pdf_out, 'PDF', resolution=110.0)

SHAKTI = ("Shakti Cables & Wires Pvt Ltd", "Plot 22, GIDC Estate, Vadodara, Gujarat 390010", "24AAICS7310M1Z6")
NIMBUS = ("Nimbus IT Solutions LLP", "3rd Floor, 88 Residency Road, Bengaluru, Karnataka 560025", "29AAKFN2286P1ZE")
GANGES = ("Ganges Logistics & Freight", "Transport Nagar, Kanpur, Uttar Pradesh 208023", "09AAFFG5512Q1ZZ")
APEX = ("Apex Electrical Testing Labs Pvt Ltd", "Unit 7, MIDC Bhosari, Pune, Maharashtra 411026", "27AAECA9043R1Z2")

COLS_STD = [('#', 22, 'L', 'sno'), ('Description', 230, 'L', 'desc'), ('HSN/SAC', 60, 'L', 'hsn'), ('Qty', 50, 'R', 'qty'), ('Rate', 70, 'R', 'rate'), ('Amount', 83, 'R', 'amt')]
COLS_NOHSN = [('S.No', 30, 'L', 'sno'), ('Particulars', 290, 'L', 'desc'), ('Qty', 55, 'R', 'qty'), ('Rate (INR)', 70, 'R', 'rate'), ('Value (INR)', 70, 'R', 'amt')]

def items(rows):
    return [dict(desc=d, hsn=h, qty=q, rate=inr(r), amt=inr(a)) for d, h, q, r, a in rows]

INVOICES = {
 # 1. Happy path: clean digital PDF, explicit PO, numbers match PO, correct IGST (inter-state)
 '01_happy_nimbus_laptops.pdf': dict(style='A', seller=NIMBUS,
   meta=[('Invoice No:', 'NIM/26-27/0871'), ('Invoice Date:', '05/11/2026'), ('PO No:', 'PO-2026-0418'), ('Place of Supply:', 'Uttar Pradesh (09)')],
   cols=COLS_STD, items=items([('Business Laptop 14" i7 / 16GB / 512GB SSD', '84713010', '10 nos', 62000, 620000),
                               ('USB-C Docking Station', '84733099', '10 nos', 8500, 85000)]),
   totals=[('Taxable Value', inr(705000), False), ('IGST @ 18%', inr(126900), False), ('Invoice Total (INR)', inr(831900), True)],
   notes=['Amount in words: Rupees Eight Lakh Thirty One Thousand Nine Hundred Only'], bank='Bank: HDFC Bank A/c ****4417  IFSC HDFC0000123'),
 # 2. Duplicate: same invoice re-sent as a different file (different layout/date format, "re-sent" stamp)
 '02_duplicate_nimbus_resend.pdf': dict(style='D', seller=NIMBUS, title='TAX INVOICE (COPY)', stamp='RE-SENT',
   meta=[('Inv #:', 'NIM/26-27/0871'), ('Dated:', '05-Nov-2026'), ('Your PO:', 'PO-2026-0418')],
   cols=COLS_NOHSN, items=items([('Laptop - Business 14 inch (i7, 16 GB RAM, 512 GB SSD)', '', '10', 62000, 620000),
                                 ('Docking station, USB-C', '', '10', 8500, 85000)]),
   totals=[('Sub-total', inr(705000), False), ('IGST 18%', inr(126900), False), ('Grand Total', inr(831900), True)],
   notes=['Re-sending as per your request. Kindly process at the earliest.'], bank='HDFC Bank  A/c ****4417'),
 # 3. Split PO over-billing: line 1 already billed (see invoice_history.csv); this invoice bills 26 drums vs 20 ordered
 '03_split_overbilling_apex.pdf': dict(style='C', seller=APEX,
   meta=[('Invoice No.', 'APX/2026/131'), ('Date', '14.11.2026'), ('Against PO', 'PO-2026-0425'), ('Ref', 'Second & final bill')],
   cols=COLS_STD, items=items([('Routine test - LT power cable (per drum)', '998346', '26 drums', 10000, 260000)]),
   totals=[('Taxable Amount', inr(260000), False), ('IGST 18%', inr(46800), False), ('Total Payable', inr(306800), True)],
   notes=['Type tests billed earlier vide APX/2026/112.', 'Six additional drums tested at site as instructed by your engineer.'], bank='ICICI Bank A/c ****0921'),
 # 4. Scanned image (no text layer), invoice number field left blank
 '04_scanned_missing_invoice_no_shakti.pdf': dict(style='B', seller=SHAKTI,
   meta=[('Invoice No:', ''), ('Date:', '09/11/2026'), ('Order Ref:', 'PO/2026/0412'), ('Transport:', 'VRL Logistics LR 55821')],
   cols=COLS_STD, items=items([('LT-AL-3.5C-XLPE-SWA 1.1kV 3.5 Core Al XLPE Armd', '85444999', '2000 m', 450, 900000),
                               ('CTRL-CU-4C-PVC-SWA 1.1kV 4 Core Cu PVC Armd', '85444999', '1000 m', 320, 320000)]),
   totals=[('Taxable Value', inr(1220000), False), ('IGST 18%', inr(219600), False), ('Total', inr(1439600), True)],
   notes=['Goods dispatched in 6 drums.'], bank='SBI A/c ****7782  IFSC SBIN0004521'),
 # 5. No PO reference: vendor has two open POs; must be inferred from description + amount (intra-state CGST+SGST)
 '05_no_po_reference_ganges.pdf': dict(style='D', seller=GANGES, title='TAX INVOICE',
   meta=[('Bill No.', 'GLF/1187'), ('Date', '12/11/2026'), ('Period', 'Nov-2026')],
   cols=COLS_NOHSN, items=items([('Warehousing and handling charges for the month of Nov-2026', '', '1', 216000, 216000)]),
   totals=[('Taxable Value', inr(216000), False), ('CGST @ 9%', inr(19440), False), ('SGST @ 9%', inr(19440), False), ('Total', inr(254880), True)],
   notes=['SAC 996729. Payment within 30 days.'], bank='Punjab National Bank A/c ****3390'),
 # 6. Wrong tax type: inter-state supplier (Gujarat -> UP) charges CGST+SGST instead of IGST; PO ref in a different format
 '06_wrong_tax_type_shakti.pdf': dict(style='B', seller=SHAKTI,
   meta=[('Invoice No:', 'SCW/2026/2291'), ('Date:', '13/11/2026'), ('Order Ref:', '2026-0430')],
   cols=COLS_STD, items=items([('BW-CU-1C-PVC-FR 1.1kV Single Core Cu PVC FR Wire', '85444920', '5000 m', 18, 90000)]),
   totals=[('Taxable Value', inr(90000), False), ('CGST @ 9%', inr(8100), False), ('SGST @ 9%', inr(8100), False), ('Total', inr(106200), True)],
   notes=['Goods dispatched in 50 coils of 100 m.'], bank='SBI A/c ****7782  IFSC SBIN0004521'),
}

if __name__ == '__main__':
    import os
    out = 'samples'  # also add new files to samples/manifest.json and a fixture in tests/fixtures/extractions
    for name, spec in INVOICES.items():
        target = os.path.join(out, name)
        if 'scanned' in name:
            import tempfile; tmp = os.path.join(tempfile.mkdtemp(), name)
            draw_invoice(tmp, spec); scan(tmp, target)
        else:
            draw_invoice(target, spec)
        print('wrote', target)
