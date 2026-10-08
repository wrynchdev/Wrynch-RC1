"""Export the ontology to src/data/ontology.json for the app.

Run: python3 ontology/build/export_json.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from checks import CLASSES, CHECKS  # noqa: E402
from findings import FINDINGS, CLASS_FINDINGS  # noqa: E402
from shop import SHOP_POINTS, SHOP_MAP  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "src", "data", "ontology.json")
R = {"ok": "ok", "monitor": "monitor", "immediate_attention": "immediate"}

# Machine-readable numeric thresholds: [operator, value] for the OK band and the Immediate band.
# Anything not listed is rated by the technician picking OK / Monitor / Immediate.
AUTO = {
    "tire.tread_depth": (">=", 6, "<=", 2),
    "tire.tread_wear_pattern": ("<", 2, None, None),
    "tire.age": ("<", 6, None, None),
    "spare_tire.age": ("<", 6, None, None),
    "brake_pad.lining_thickness": (">=", 5, "<=", 2),
    "brake_shoe.lining_thickness": (">=", 3, "<=", 1),
    "brake_pad.wear_pattern": ("<", 2, None, None),
    "brake_fluid.copper": ("<", 100, ">=", 200),
    "brake_fluid.moisture": ("<", 2, ">=", 3),
    "steering_wheel.free_play": ("<=", 1, ">=", 2),
    "outer_tie_rod_end.play": ("<=", 0, ">=", 0.25),
    "inner_tie_rod.play": ("<=", 0, ">=", 0.25),
    "idler_arm.play": ("<=", 0, ">=", 0.25),
    "pitman_arm.play": ("<=", 0, ">=", 0.25),
    "center_link.play": ("<=", 0, ">=", 0.25),
    "drag_link.play": ("<=", 0, ">=", 0.25),
    "shock_absorber.damping": ("<=", 1, ">", 2),
    "strut_assembly.damping": ("<=", 1, ">", 2),
    "engine_oil.oil_life": (">", 25, "<=", 5),
    "engine_coolant.freeze_point": ("<=", -30, ">", -15),
    "diesel_exhaust_fluid.level": (">", 25, "<", 10),
    "low_voltage_battery.measured_cca": (">=", 85, "<", 70),
    "low_voltage_battery.open_circuit_voltage": (">=", 12.4, None, None),
    "low_voltage_battery.cranking_voltage": (">=", 9.6, "<", 9.6),
    "cabin_air_vent.ac_performance": ("<=", 45, None, None),
    "high_voltage_battery_pack.state_of_health": (">=", 80, "<", 70),
}
UNIT_SHORT = {"32nds of an inch": "/32 in", "mm": "mm", "ppm": "ppm", "% water": "%", "inches at rim": "in",
              "inches": "in", "oscillations": "cycles", "% remaining": "%", "°F": "°F", "% full": "%",
              "% of rated": "% of rated", "volts": "V", "years": "yr", "% SOH": "%"}

# Vehicle-configuration conditions used by the shop template -> predicate ids evaluated in the app
COND = {
    "all": "always", "combustion engine": "combustion", "gasoline engine": "gasoline",
    "rear disc brakes": "rearDisc", "rear drum brakes": "rearDrum", "rack-and-pinion": "rack",
    "recirculating-ball steering": "recirc", "parallelogram linkage": "parallelogram",
    "front struts": "frontStruts", "front shocks (non-strut)": "frontShocks", "rear shocks": "rearShocks",
    "rear struts": "rearStruts", "coil springs": "coilSprings", "rear leaf springs": "rearLeaf",
    "FWD/AWD": "fwdOrAwd", "independent rear drive": "independentRearDrive", "RWD/AWD/4WD": "rwdAwd4wd",
    "4WD/AWD front differential": "frontDiff", "4WD/AWD with transfer case": "transferCase",
    "rear differential": "rearDiff", "two-piece driveshaft": "twoPieceDriveshaft", "solid axle": "solidAxle",
    "automatic transmission": "automatic", "manual transmission": "manual",
    "hydraulic power steering": "hydraulicSteering", "engine has timing belt": "timingBelt",
    "engine has timing chain": "timingChain", "fog lamps when equipped": "fogLamps",
    "rear wiper equipped": "rearWiper", "cabin filter equipped": "cabinFilter",
    "serviceable fuel filter": "fuelFilter",
    "EV/PHEV/HEV": "electrified", "BEV/PHEV": "plugIn", "BEV front motor": "evFrontMotor", "BEV rear motor": "evRearMotor",
    **{"charge port " + p.replace("_", " "): "chargePort:" + p for p in ("left_front", "right_front", "left_rear", "right_rear", "front", "rear")},
    "one instance per lit lamp": "onDemand", "when a thermostat code/symptom is present": "onDemand",
}


def clean(v):
    return None if v in (None, "", "—") else v


classes = []
for c in CLASSES:
    classes.append({
        "id": c["id"], "name": c["name"], "label": c["display"][:1].upper() + c["display"][1:],
        "category": c["category"], "safety": c["safety_critical"], "aiPhoto": c["ai_photo"],
        "capture": c["capture"], "positionRule": c["position_rule_code"],
        "positions": [p.strip() for p in (c["allowed_positions"] or "").split("|") if p.strip() and "any" not in p],
        "subtypes": [s.strip() for s in (c["subtype_examples"] or "").split("|") if s.strip()],
        "checks": c["check_keys"],
        "findings": {x["key"]: [R[x["minor"]], R[x["moderate"]], R[x["severe"]], R[x["critical"]]]
                     for x in CLASS_FINDINGS if x["cname"] == c["name"]},
    })

checks = {}
for x in CHECKS:
    auto = AUTO.get(x["key"])
    checks[x["key"]] = {
        "key": x["key"], "classId": x["cid"], "name": x["name"], "method": x["method"], "how": x["reading"],
        "unit": UNIT_SHORT.get(x["unit"], clean(x["unit"])), "valueType": x["vtype"],
        "bands": {"ok": x["ok"], "monitor": clean(x["mon"]), "immediate": clean(x["imm"])},
        "auto": None if not auto else {"ok": [auto[0], auto[1]], "immediate": [auto[2], auto[3]] if auto[2] else None},
        "evidence": x["evidence"], "basis": x["basis"],
        "failFindings": [t.strip() for t in x["fail"].replace("…", "").split("|") if t.strip()],
    }

findings = {f["key"]: {"key": f["key"], "label": f["key"].replace("_", " ").capitalize(), "definition": f["definition"]}
            for f in FINDINGS}

KEEP_UPPER = {"LF", "RF", "LR", "RR", "VIN", "HVAC", "CV"}
SMALL = {"and", "or", "of", "etc.)", "etc"}


def nice(name):
    """Shop point names are ALL CAPS in the source; make them readable but keep acronyms."""
    out = []
    for i, w in enumerate(name.split()):
        core = w.strip("(),.")
        if core in KEEP_UPPER:
            out.append(w)
        else:
            lw = w.lower()
            out.append(lw if (i and lw.strip("(),") in SMALL) else lw[:1].upper() + lw[1:] if i == 0 else lw)
    return " ".join(out)


sections, seen = [], {}
for pid, sec, name, n, note in SHOP_POINTS:
    if sec not in seen:
        seen[sec] = {"id": sec.lower().replace(" ", "_"), "name": sec[:1] + sec[1:].lower(), "points": []}
        sections.append(seen[sec])
    comps = []
    for r in SHOP_MAP:
        if r[0] != pid or r[3] is None:
            continue
        comps.append({"classId": r[3], "position": r[5] or None, "required": r[6] == "Yes", "when": COND[r[7]]})
    seen[sec]["points"].append({"id": pid, "name": nice(name),
                                "note": note, "components": comps})

data = {"version": "1.4.0", "classes": classes, "checks": checks, "findings": findings,
        "template": {"id": "shop-mpi", "name": "Shop MPI", "sections": sections}}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(data, f, separators=(",", ":"))
print("wrote", os.path.normpath(OUT), os.path.getsize(OUT), "bytes;", len(classes), "classes,", len(checks), "checks,",
      sum(len(s["points"]) for s in sections), "points")
