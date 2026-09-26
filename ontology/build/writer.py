"""Write the v1.1 ontology workbook matching the original workbook's styling."""
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

import base
from base import CHANGES, SHEET_DESC, CLASS_NOTES, FLAG_COLS, MAP_HDR, log
from checks import CLASSES, CHECKS, SOURCES
from findings import FINDINGS, CLASS_FINDINGS
from template import STAGES, P, TEMPLATE_ROWS
from model import SCHEMA, VALUES, DM, RATING, RULES, README
from shop import SHOP_POINTS, SHOP_MAP, EX

OUT = sys.argv[1]
FONT = "Carlito"
TITLE_FILL = PatternFill("solid", fgColor="FF111827")
DESC_FILL = PatternFill("solid", fgColor="FFE5E7EB")
HDR_FILL = PatternFill("solid", fgColor="FF1F4E78")
NOTE_FILL = PatternFill("solid", fgColor="FFFFF7ED")
NEW_FILL = PatternFill("solid", fgColor="FFEFF6FF")
WRAP = Alignment(wrap_text=True, vertical="top")
GREEN, YELLOW, RED, GRAY = "FFD1FAE5", "FFFEF3C7", "FFFEE2E2", "FFE5E7EB"

wb = Workbook()
wb.remove(wb.active)
tables = set()


def sheet(name, title, desc, headers, rows, widths, table_name, notes=(), new_rows=None, freeze=True):
    ws = wb.create_sheet(name)
    ncol = len(headers)
    last = get_column_letter(ncol)
    ws.merge_cells(f"A2:{last}2")
    ws.merge_cells(f"A3:{last}3")
    ws["A2"] = title
    ws["A2"].font = Font(name=FONT, size=16, bold=True, color="FFFFFFFF")
    ws["A2"].fill = TITLE_FILL
    ws["A2"].alignment = Alignment(vertical="center")
    ws.row_dimensions[2].height = 28
    ws["A3"] = desc
    ws["A3"].font = Font(name=FONT, size=11, color="FF374151")
    ws["A3"].fill = DESC_FILL
    ws["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[3].height = max(32, 16 * (1 + len(desc) // 150))
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=5, column=j, value=h)
        c.font = Font(name=FONT, size=11, bold=True, color="FFFFFFFF")
        c.fill = HDR_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[5].height = 32
    for i, r in enumerate(rows):
        for j, v in enumerate(r, 1):
            if isinstance(v, bool):
                pass
            elif v is None:
                v = None
            c = ws.cell(row=6 + i, column=j, value=v)
            c.font = Font(name=FONT, size=11)
            c.alignment = WRAP
            if new_rows and new_rows(i):
                c.fill = NEW_FILL
    import math
    for i, r in enumerate(rows):
        lines = 1
        for j, v in enumerate(r):
            if v is None or j >= len(widths):
                continue
            chars = max(1.0, widths[j] * 1.15)
            lines = max(lines, sum(math.ceil(max(1, len(part)) / chars) for part in str(v).split("\n")))
        ws.row_dimensions[6 + i].height = min(409, 15 * lines + 3)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    end = 5 + max(1, len(rows))
    t = Table(displayName=table_name, ref=f"A5:{last}{end}")
    t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(t)
    for j, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(j)].width = w
    r0 = end + 2
    for n in notes:
        ws.merge_cells(f"A{r0}:{last}{r0}")
        c = ws.cell(row=r0, column=1, value=n)
        c.font = Font(name=FONT, size=11, color="FF7C2D12")
        c.fill = NOTE_FILL
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r0].height = 30
        r0 += 1
    if freeze:
        ws.freeze_panes = "C6" if ncol > 6 else "A6"
    ws.sheet_view.zoomScale = 100
    return ws


def rating_cf(ws, rng):
    for val, fill in [("ok", GREEN), ("monitor", YELLOW), ("immediate_attention", RED)]:
        ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=[f'"{val}"'], fill=PatternFill("solid", fgColor=fill)))


def yn(b):
    return "Yes" if b else "No"


# ------------------------------------------------------------------ README
ws = sheet("README", "Wrynch canonical component ontology — release 1.2.0",
           "How to read this workbook. Blue-tinted rows in any sheet are new since 1.0.0.",
           ["Topic", "Explanation"], README, [26, 140], "ReadmeTable", freeze=False)

# ------------------------------------------------------------------ Classes
t, d = SHEET_DESC["Classes"]
rows = [[c["id"], c["name"], c["display"], c["category"], c["starter"], c["position_rule"], c["note"],
         yn(c["safety_critical"]), c["ai_photo"], c["capture"], c["added_in"], c["status"]] for c in CLASSES]
sheet("Classes", t, d, ["Class ID (0-based)", "Class name", "Display name", "Category", "Starter model", "Position rule",
                        "Annotation note", "Safety critical", "AI photo assessable", "Photo capture guidance (bulk upload / AI mapping)",
                        "Added in", "Status"], rows, [14, 30, 30, 20, 12, 34, 48, 12, 14, 60, 10, 10], "ClassesTable",
      notes=list(CLASS_NOTES) + ["A component on a vehicle = class + position (e.g. brake_pad @ left_front). History and timelines are kept per component."],
      new_rows=lambda i: CLASSES[i]["new"])

# ------------------------------------------------------------------ Class Metadata Map
t, d = SHEET_DESC["Class Metadata Map"]
hdr = list(MAP_HDR) + ["Position rule code", "Allowed position values", "Implied position (default)"]
rows = []
for c in CLASSES:
    f = c["flags"]
    rows.append([c["id"], c["name"], c["display"], c["category"]] + [f[k] for k in FLAG_COLS] +
                [c["subtype_examples"], c["map_note"], c["position_rule_code"], c["allowed_positions"], c["implied_position"]])
sheet("Class Metadata Map", t, d, hdr, rows, [10, 28, 28, 20] + [13] * len(FLAG_COLS) + [40, 42, 20, 44, 16],
      "ClassMetadataMapTable", new_rows=lambda i: CLASSES[i]["new"])

# ------------------------------------------------------------------ Metadata Schema / Values
t, d = SHEET_DESC["Metadata Schema"]
n0 = len(base.schema_rows)
sheet("Metadata Schema", t, d, list(base.SCHEMA_HDR), SCHEMA, [28, 26, 22, 24, 42, 80], "MetadataSchemaTable",
      new_rows=lambda i: i >= n0)
t, d = SHEET_DESC["Metadata Values"]
v0 = len(base.value_rows)
sheet("Metadata Values", t, d, list(base.VALUES_HDR), VALUES, [28, 30, 80, 14], "MetadataValuesTable",
      new_rows=lambda i: i >= v0)

# ------------------------------------------------------------------ Condition Findings
t, d = SHEET_DESC["Condition Findings"]
rows = [[f["key"], f["scope"], f["definition"], f["evidence"], f["notes"], f["added_in"],
         sum(1 for x in CLASS_FINDINGS if x["key"] == f["key"])] for f in FINDINGS]
sheet("Condition Findings", t, d, list(base.FIND_HDR) + ["Added in", "Classes using it"], rows, [24, 26, 72, 36, 60, 10, 12],
      "ConditionFindingsTable", new_rows=lambda i: FINDINGS[i]["added_in"] != "1.0.0")

# ------------------------------------------------------------------ Class Findings
rows = [[x["cid"], x["cname"], x["key"], x["source"], x["minor"], x["moderate"], x["severe"], x["critical"], x["note"]] for x in CLASS_FINDINGS]
ws = sheet("Class Findings", "Class-to-finding applicability and default ratings",
           "Which findings a technician (or AI) may record on each class, and the default rating at each severity. AI proposals are restricted to these findings. Shops may override defaults.",
           ["Class ID", "Class name", "Finding key", "Applicability source", "Rating if minor", "Rating if moderate",
            "Rating if severe", "Rating if critical", "Rating rule"], rows, [10, 30, 22, 18, 18, 18, 18, 18, 60], "ClassFindingsTable")
rating_cf(ws, f"E6:H{5+len(rows)}")

# ------------------------------------------------------------------ Condition Checks
rows = []
for i, x in enumerate(CHECKS, 1):
    rows.append([f"C{i:04d}", x["cid"], x["cname"], x["key"], x["name"], x["method"], x["reading"], x["unit"], x["vtype"],
                 x["better"], x["ok"], x["mon"], x["imm"], x["ok_lim"], x["imm_lim"], x["spec"], x["evidence"], x["ai"],
                 x["fail"], x["basis"]])
ws = sheet("Condition Checks", "Condition checks by class — how each component is rated",
           "Each class has one or more checks. Measured checks have OK / Monitor / Immediate Attention thresholds in US units; visual checks rate from Class Findings. Numeric limits: 'OK limit' is the boundary of OK, 'Immediate limit' the boundary of Immediate Attention (direction per 'Better when'). All thresholds are shop-configurable defaults; OEM specs take precedence.",
           ["Check ID", "Class ID", "Class name", "Check key", "Check name", "Method", "What to check / measure", "Unit",
            "Value type", "Better when", "OK", "Monitor", "Immediate attention", "OK limit", "Immediate limit",
            "Spec source", "Evidence", "AI photo assessable", "Findings when not OK", "Basis / source"],
           rows, [10, 9, 26, 32, 30, 16, 40, 16, 12, 11, 28, 30, 36, 9, 10, 26, 22, 12, 34, 34], "ConditionChecksTable")
for col, fill in [("K", GREEN), ("L", YELLOW), ("M", RED)]:
    for r in range(6, 6 + len(rows)):
        ws[f"{col}{r}"].fill = PatternFill("solid", fgColor=fill)

# ------------------------------------------------------------------ Rating Scale
ws = sheet("Rating Scale", "Rating scale and derivation rules",
           "The three determinations (OK, Monitor, Immediate Attention) plus the non-rating states, and how a component's rating is derived.",
           ["Value", "Label", "Color", "Meaning", "Customer presentation"], [list(r) for r in RATING], [22, 20, 10, 80, 40], "RatingScaleTable",
           notes=[f"{a} — {b}: {c}" for a, b, c in RULES], freeze=False)
rating_cf(ws, "A6:A11")

# ------------------------------------------------------------------ Starter template
rows = [[i, k, n, ins, sum(1 for p in P if p["stage"] == k)] for i, (k, n, ins) in enumerate(STAGES, 1)]
sheet("Starter Template Stages", "Starter template — stages",
      "Stages are the bulk-capture unit: the technician shoots every photo for a stage at once and AI maps each photo to a point/component within that stage.",
      ["Order", "Stage key", "Stage name", "Bulk capture instructions", "Points"], rows, [8, 16, 28, 100, 8], "TemplateStagesTable", freeze=False)
stage_name = {k: n for k, n, _ in STAGES}
rows = [[p["id"], stage_name[p["stage"]], p["name"], p["instr"], sum(1 for r in TEMPLATE_ROWS if r["pid"] == p["id"])] for p in P]
sheet("Starter Template Points", "Starter template — inspection points",
      "Points are what the technician sees. They carry no component identity of their own; identity comes from the component map.",
      ["Point ID", "Stage", "Point name", "Instruction", "Components mapped"], rows, [10, 26, 34, 90, 12], "TemplatePointsTable", freeze=False)
rows = [[r["pid"], stage_name[r["stage"]], r["point"], r["cid"], r["cname"], r["position"], r["required"], r["when"], r["checks"], r["role"]] for r in TEMPLATE_ROWS]
sheet("Template Component Map", "Starter template — point to component map",
      "One row per expected component instance (class + position). 'Applies when' is evaluated against the vehicle configuration (VIN decode or technician); rows that don't apply are N/A, not missing. 'Required' means the point cannot be completed without a rating for this component.",
      ["Point ID", "Stage", "Point name", "Class ID", "Class name", "Position", "Required", "Applies when", "Checks", "Expected evidence role"],
      rows, [10, 24, 30, 9, 30, 14, 10, 30, 70, 14], "TemplateComponentMapTable")

# ------------------------------------------------------------------ Shop template + example
sheet("Shop Template Points", "Shop's current MPI template — points",
      "The shop's existing multi-point inspection (34 points, from app screenshots) with the number of canonical components each point expands to. Point names are kept verbatim; they are display wording only.",
      ["Shop point ID", "Section", "Shop point name", "Components mapped", "Mapping note"], SHOP_POINTS, [12, 14, 52, 12, 90], "ShopTemplatePointsTable", freeze=False)
sheet("Shop Template Map", "Shop's current MPI template — point to component map",
      "One row per expected component instance. 'Applies when' is resolved from the vehicle configuration so, e.g., rear drum rows become N/A on a rear-disc vehicle.",
      ["Shop point ID", "Section", "Shop point name", "Class ID", "Class name", "Position", "Required", "Applies when", "Checks"],
      SHOP_MAP, [12, 14, 44, 9, 34, 14, 10, 30, 70], "ShopTemplateMapTable")
rows = [[i, *e] for i, e in enumerate(EX, 1)]
ws = sheet("Example Inspection", "Worked example — a real inspection run through the ontology",
           "Each row is what Wrynch would store for one shop point from the supplied screenshots (AWD vehicle, ~164,000 mi, DTCs P0128 and P0420). 'Agrees?' compares the tech's color with Wrynch's default rating.",
           ["#", "Shop point", "Tech wrote", "Shop rating", "Canonical component(s)", "Finding / measurement recorded", "Wrynch rating", "Agrees?", "What changes with Wrynch"],
           rows, [5, 30, 44, 18, 32, 50, 22, 9, 60], "ExampleInspectionTable", freeze=False)
for val, fill in [("No", RED), ("Partly", YELLOW), ("Review", YELLOW)]:
    ws.conditional_formatting.add(f"H6:H{5+len(rows)}", CellIsRule(operator="equal", formula=[f'"{val}"'], fill=PatternFill("solid", fgColor=fill)))

# ------------------------------------------------------------------ Data Model
t, d = SHEET_DESC["Data Model"]
dm0 = len(base.dm_rows)
sheet("Data Model", t, d, list(base.DM_HDR), DM, [28, 30, 20, 34, 16, 26, 80], "DataModelTable", new_rows=lambda i: i >= dm0)

# ------------------------------------------------------------------ Change log & sources
log("Workbook", "Shop template + example", "(none)", "Shop Template Points, Shop Template Map, Example Inspection",
    "Maps the shop's current MPI to components and tests the rating rules on a real inspection.", "No", "1.2.0")
log("Shop Template", "EV / Hybrid section", "(none)", "4 points: HV battery, HV cables, charge port, electric drive units", "Electrified vehicles need their own points; the section only applies when the vehicle is EV/PHEV/HEV.", "Yes", "1.3.0")
log("Classes", "thermostat (ID 281)", "(missing)", "thermostat", "Shop notes attribute P0128 to the thermostat; only thermostat_housing existed.", "No", "1.2.0")
log("Condition Checks", "Battery measured CCA %", "(none)", "OK ≥ 85%, Monitor 70–84%, Immediate < 70%", "Shop records rated vs tested CCA (800 → 601). Threshold is a Wrynch default.", "Yes", "1.2.0")
log("Condition Checks", "Engine oil overfill", "Above FULL = Immediate", "Slightly above FULL = Monitor; ~1 qt or more over = Immediate", "Tech rated a slight overfill as yellow.", "No", "1.2.0")
log("Condition Checks", "A/C", "Vent > 55°F = Immediate", "Vent temp and smoking clutch = Monitor; Immediate only if the compressor seizes and stops the drive belt", "A/C is comfort; red is reserved for failing a minimum standard.", "No", "1.2.0")
log("Condition Checks", "Red-line thresholds", "Tread ≤ 3/32, pads ≤ 3/32, tire age ≥ 10 yr, battery < 12.2 V, tie-rod any play = Immediate",
    "Tread ≤ 2/32 (49 CFR 570.9), pads ≤ 2/32 or indicator/OEM min, shoes ≤ 1/32 (49 CFR 570.5), linkage play ≥ 1/4 in (49 CFR 570.7); tire age and low battery voltage never red on their own",
    "Shop definition of red: no longer performs to minimum regulations.", "No", "1.2.0")
log("Condition Checks", "thermostat.regulation", "(none)", "new check", "Warm-up data / DTC based.", "No", "1.2.0")
log("Condition Checks", "Brake measurement units", "pads/shoes in 32nds; rotor/drum in inches",
    "mm: pads OK ≥ 5 / Monitor 2–5 / Immediate ≤ 2; shoes OK ≥ 3 / Monitor 1–3 / Immediate ≤ 1; rotor/drum Monitor within 0.8 mm of the stamped limit",
    "Shop techs measure brakes in mm and most rotors/drums are stamped in mm. All other checks stay US customary.", "No", "1.2.0")
log("Workbook", "New sheets", "6 sheets", "README, Class Findings, Condition Checks, Rating Scale, Starter Template (3 sheets), Change Log, Sources",
    "Adds the per-class checks, finding applicability, ratings and a worked template mapping.")
log("Condition Checks", "Thresholds", "(none)", f"{len(CHECKS)} checks", "Default OK/Monitor/Immediate thresholds in US units with sources; shop-configurable.", "Yes")
log("Class Findings", "Cosmetic findings", "(none)", "minor = ok, moderate/severe = monitor",
    "Cosmetic damage (dents, scratches, chips in paint) is documented but not treated as needing repair.", "Yes")
rows = [[i, *c] for i, c in enumerate(CHANGES, 1)]
ws = sheet("Change Log", "Change log — release 1.0.0 → 1.2.0", "Every change made to the supplied workbook. 'Needs your review' marks judgment calls.",
           ["#", "Release", "Sheet", "Item", "Before", "After", "Reason", "Needs your review"], rows, [6, 10, 22, 36, 30, 36, 70, 12], "ChangeLogTable", freeze=False)
ws.conditional_formatting.add(f"H6:H{5+len(rows)}", CellIsRule(operator="equal", formula=['"Yes"'], fill=PatternFill("solid", fgColor=YELLOW)))
ws = sheet("Sources", "Sources for check thresholds", "Referenced from Condition Checks → Basis / source.",
           ["ID", "What it supports", "URL"], [list(s) for s in SOURCES], [8, 70, 90], "SourcesTable", freeze=False)
for r in range(6, 6 + len(SOURCES)):
    c = ws[f"C{r}"]
    c.hyperlink = c.value
    c.font = Font(name=FONT, size=11, color="FF1D4ED8", underline="single")

wb.properties.title = "Wrynch Vehicle Component Ontology 1.2.0"
wb.save(OUT)
print("saved", OUT, [ws.title for ws in wb.worksheets])
