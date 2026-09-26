"""Load the original ontology workbook and apply structural fixes to classes/positions."""
from openpyxl import load_workbook

import os
SRC = os.path.join(os.path.dirname(__file__), "..", "source", "Vehicle_Component_Classes_Metadata_Ontology_v1.0.xlsx")

CHANGES = []  # (sheet, item, before, after, reason, needs_review)


def log(sheet, item, before, after, reason, review="No", release="1.1.0"):
    CHANGES.append((release, sheet, item, str(before), str(after), reason, review))


def _rows(ws):
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[4]
    data = [r for r in rows[5:] if len(r) > 0 and r[0] is not None]
    return hdr, data, rows


wb = load_workbook(SRC)
_, cls_rows, cls_all = _rows(wb["Classes"])
CLASS_NOTES = [r[0] for r in cls_all[5:] if len(r) > 0 and r[0] is not None and not isinstance(r[0], int)]
cls_rows = [r for r in cls_rows if isinstance(r[0], int)]
MAP_HDR, map_rows, _ = _rows(wb["Class Metadata Map"])
map_rows = [r for r in map_rows if isinstance(r[0], int)]
SCHEMA_HDR, schema_rows, _ = _rows(wb["Metadata Schema"])
VALUES_HDR, value_rows, _ = _rows(wb["Metadata Values"])
FIND_HDR, finding_rows, _ = _rows(wb["Condition Findings"])
DM_HDR, dm_rows, _ = _rows(wb["Data Model"])
SHEET_DESC = {ws.title: (ws["A2"].value, ws["A3"].value) for ws in wb.worksheets}

FLAG_COLS = list(MAP_HDR[4:21])  # Position allowed .. Technician review

# ---------------------------------------------------------------- classes
CLASSES = []  # list of dicts
for r in cls_rows:
    m = next(x for x in map_rows if x[0] == r[0])
    d = dict(id=r[0], name=r[1], display=r[2], category=r[3], starter=r[4],
             position_rule=r[5], note=r[6], added_in="1.0.0", status="active",
             flags={FLAG_COLS[i]: m[4 + i] for i in range(len(FLAG_COLS))},
             subtype_examples=m[21], map_note=m[22])
    CLASSES.append(d)
BY_NAME = {c["name"]: c for c in CLASSES}

# ---- category fix
BY_NAME["horn"]["category"] = "electrical"
log("Classes", "horn.category", "lighting", "electrical",
    "Horn is an audible warning device, not a lamp; keeps lighting finding/check rules clean.")

# ---- position rule codes and allowed values
CORNERS = "left_front | right_front | left_rear | right_rear"
SIDES = "left | right | left_front | right_front | left_rear | right_rear"
SEATS = "left_front | right_front | left_mid | center | right_mid | left_rear | right_rear"

# classes where a repeated physical part must carry a position for a per-part timeline
MAKE_REQUIRED = {
    # corner-located wheel-end / brake / suspension parts
    **{n: ("required", CORNERS, "Corner required") for n in [
        "tire", "wheel", "tire_valve_stem", "brake_rotor", "brake_caliper", "brake_pad", "brake_drum",
        "brake_shoe", "brake_backing_plate", "brake_hose", "brake_wheel_cylinder", "shock_absorber",
        "strut_assembly", "coil_spring", "air_spring", "control_arm", "ball_joint", "sway_bar_link",
        "steering_knuckle", "cv_axle", "cv_boot"]},
    "leaf_spring": ("required", "left_rear | right_rear | left_front | right_front", "Side required"),
    **{n: ("required", "left | right", "Side required") for n in [
        "outer_tie_rod_end", "inner_tie_rod", "steering_rack_boot"]},
    **{n: ("required", SIDES + " | front | rear | center", "Position required") for n in [
        "headlamp", "tail_lamp", "turn_signal_lamp", "fog_lamp", "reverse_lamp", "side_marker_lamp"]},
    "sliding_door": ("required", "left | right", "Side required"),
    "stone_guard": ("required", "front | rear | " + SIDES, "Position required"),
}
MAKE_CONDITIONAL = {
    "wiper_blade": ("required_if_multiple", "left_front | right_front | rear", "Position required when more than one"),
    "wiper_arm": ("required_if_multiple", "left_front | right_front | rear", "Position required when more than one"),
    "driveshaft": ("required_if_multiple_axles", "front | rear", "Front/rear required when multiple driveshafts exist"),
}
for n in ["differential_housing", "differential_cover", "differential_fill_plug", "differential_drain_plug"]:
    MAKE_CONDITIONAL[n] = ("required_if_multiple_axles", "front | rear | center",
                           "Front/rear required when multiple axle locations exist")

IMPLIED = {}
for c in CLASSES:
    rule = (c["position_rule"] or "")
    if "implied" in rule.lower():
        low = rule.lower()
        pos = ("rear" if "rear" in low else "front" if "front" in low else "roof" if "roof" in low
               else "bed" if "bed" in low else None)
        IMPLIED[c["name"]] = pos

for c in CLASSES:
    f = c["flags"]
    n = c["name"]
    before = (f["Position allowed"], f["Position required"])
    if n in MAKE_REQUIRED:
        code, vals, text = MAKE_REQUIRED[n]
        f["Position allowed"], f["Position required"] = True, True
    elif n in MAKE_CONDITIONAL:
        code, vals, text = MAKE_CONDITIONAL[n]
        f["Position allowed"], f["Position required"] = True, False
    elif n in IMPLIED:
        code, vals, text = "implied", IMPLIED[n], c["position_rule"]
        f["Position allowed"], f["Position required"] = True, False
    elif f["Position required"]:
        code, vals, text = "required", None, c["position_rule"]
    elif f["Position allowed"]:
        code, vals, text = "optional", None, c["position_rule"]
    else:
        code, vals, text = "none", None, c["position_rule"]
    if vals is None:
        low = (c["position_rule"] or "").lower()
        vals = (CORNERS if "corner" in low else "front | rear" if "front/rear" in low
                else SEATS.replace(" | center", "") if "side/row" in low
                else SIDES if ("side" in low or "left/right" in low) and "rear" not in low
                else "left_rear | right_rear | rear" if "side/rear" in low
                else "left_front | right_front | left_rear | right_rear" if "door position" in low
                else "any position value" if code in ("required", "optional") else "")
    c["position_rule_code"] = code
    c["allowed_positions"] = vals
    c["implied_position"] = IMPLIED.get(n)
    if text and text != c["position_rule"]:
        log("Classes", f"{n}.position_rule", c["position_rule"], text,
            "Rule text aligned with position flags.")
        c["position_rule"] = text
        c["map_note"] = text
    after = (f["Position allowed"], f["Position required"])
    if before != after:
        reason = {
            "required": "Repeated part: each instance needs a position so its condition history stays separate (e.g. LF vs RF pad).",
            "required_if_multiple": "Required only when the vehicle has more than one; evaluated from vehicle configuration.",
            "required_if_multiple_axles": "Required only when the vehicle has more than one axle location; evaluated from vehicle configuration.",
            "implied": "Position is implied (default filled automatically) but a technician may override.",
        }.get(code, "Flag aligned with rule text.")
        if n in ("sliding_door", "stone_guard"):
            reason = "Flag contradicted rule text ('" + c["position_rule"] + "')."
        log("Class Metadata Map", f"{n} position allowed/required", before, after, reason)

# classes that genuinely repeat but had no position
for n, vals, why in [("subframe", "front | rear", "Vehicles commonly have front and rear subframes."),
                     ("cabin_air_vent", "left_front | center | right_front | rear", "Multiple vents; A/C temperature is taken at a specific vent.")]:
    c = BY_NAME[n]
    before = (c["flags"]["Position allowed"], c["flags"]["Position required"])
    c["flags"]["Position allowed"] = True
    c["position_rule_code"], c["allowed_positions"] = "optional", vals
    c["position_rule"] = c["map_note"] = "Position recommended"
    log("Class Metadata Map", f"{n} position allowed/required", before, (True, False), why)

# rocker panel undefined tokens
rp = BY_NAME["rocker_panel"]
old = rp["note"]
rp["note"] = old.replace("left_side/right_side", "left/right")
log("Classes", "rocker_panel.annotation_note", old, rp["note"],
    "left_side/right_side are not position vocabulary values.")

# material flag for sheet-less identity classes stays; nothing else to fix there.
for c in CLASSES:
    c["new"] = False
