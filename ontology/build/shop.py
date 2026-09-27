"""The shop's current multi-point inspection template mapped to canonical components, plus a worked example
using a real inspection (screenshots supplied 2026-09-26)."""
from checks import BY_NAME
from findings import CLASS_FINDINGS

C4 = ["left_front", "right_front", "left_rear", "right_rear"]
F2, R2, LR, N = ["left_front", "right_front"], ["left_rear", "right_rear"], ["left", "right"], [None]
A = "all"
LAMPS = [("headlamp", LR, "Yes", A), ("tail_lamp", LR, "Yes", A), ("turn_signal_lamp", C4, "Yes", A),
         ("high_mount_brake_lamp", N, "Yes", A), ("reverse_lamp", LR, "Yes", A), ("license_plate_lamp", N, "Yes", A),
         ("side_marker_lamp", C4, "No", A), ("fog_lamp", LR, "No", "fog lamps when equipped")]

# section, shop point name (verbatim), components, mapping note
SHOP = [
    ("Road Test", "WALKAROUND, VIN, AND TIRE PLACARD PHOTOS",
     [("vehicle_exterior", N, "Yes", A), ("vin_label", N, "Yes", A), ("tire_placard", N, "Yes", A)],
     "Walk-around photos document overall condition; body damage found here is recorded on the specific panel class (e.g. door @ left_front)."),
    ("Road Test", "ENGINE CRANKING", [("starter_motor", N, "Yes", A), ("low_voltage_battery", N, "No", A)],
     "Cranking check lands on the starter; cranking voltage (if measured) lands on the battery."),
    ("Road Test", "INSTRUMENT CLUSTER PHOTOS", [("instrument_cluster", N, "Yes", A), ("warning_indicator", N, "No", "one instance per lit lamp")],
     "Each lit lamp becomes a warning_indicator with its subtype (e.g. check_engine); codes are stored as DTCs."),
    ("Road Test", "WIPER BLADES", [("wiper_blade", F2, "Yes", A), ("wiper_blade", ["rear"], "No", "rear wiper equipped"), ("wiper_motor", ["front"], "No", A)], None),
    ("Road Test", "HVAC PERFORMANCE", [("cabin_air_vent", ["center"], "Yes", A), ("ac_compressor", N, "No", A), ("cabin_blower_motor", N, "No", A)], None),
    ("Road Test", "NOISE, VIBRATION, OR PULLING NOTICED", [],
     "Symptom point, not a component. Recorded as a vehicle_concern (noise / vibration / pull); when the cause is found it is linked to the component(s), e.g. tire, wheel_hub_bearing, brake_rotor."),
    ("Road Test", "POWERTRAIN PERFORMANCE", [("engine_assembly", N, "No", "combustion engine")],
     "Mostly a symptom check → vehicle_concern; engine running condition lands on engine_assembly."),
    ("Road Test", "HORN AND EXTERIOR LIGHTS", [("horn", N, "Yes", A)] + LAMPS,
     "One shop point becomes ~20 components, so a single burned-out bulb has its own history."),
    ("Under Hood", "HOOD LATCH AND CABLES", [("hood_latch", N, "Yes", A), ("hood_release_cable", N, "No", A), ("hood_striker", N, "No", A)], None),
    ("Under Hood", "ENGINE OIL", [("engine_oil", N, "Yes", A)], None),
    ("Under Hood", "ENGINE COOLANT", [("engine_coolant", N, "Yes", A), ("coolant_reservoir", N, "No", A), ("thermostat", N, "No", "when a thermostat code/symptom is present")],
     "The example note mixes coolant condition and a thermostat code; Wrynch records them on two components."),
    ("Under Hood", "TRANSMISSION FLUID", [("automatic_transmission_fluid", N, "Yes", "automatic transmission"), ("manual_transmission_fluid", N, "Yes", "manual transmission")], None),
    ("Under Hood", "POWER STEERING FLUID", [("power_steering_fluid", N, "Yes", "hydraulic power steering")], "N/A automatically on electric power steering."),
    ("Under Hood", "BRAKE FLUID", [("brake_fluid", N, "Yes", A), ("brake_fluid_reservoir", N, "No", A)], None),
    ("Under Hood", "HOSES AND BELTS", [("accessory_drive_belt", N, "Yes", "combustion engine"), ("belt_tensioner", N, "No", "combustion engine"),
                                      ("idler_pulley", N, "No", "combustion engine"), ("coolant_hose", N, "Yes", A), ("vacuum_hose", N, "No", "combustion engine")], None),
    ("Under Hood", "AIR FILTER", [("engine_air_filter", N, "Yes", "combustion engine"), ("engine_air_filter_housing", N, "No", "combustion engine")],
     "Example: broken air box is a finding on the housing; the filter itself is 'unable to assess'."),
    ("Under Hood", "BATTERY", [("low_voltage_battery", N, "Yes", A), ("battery_terminal", N, "No", A), ("battery_cable", N, "No", A), ("battery_hold_down", N, "No", A)], None),
    ("Under Hood", "TIMING BELT/CHAIN", [("timing_belt", N, "Yes", "engine has timing belt"), ("timing_chain", N, "Yes", "engine has timing chain")],
     "Vehicle configuration decides belt vs chain; the other becomes N/A."),
    ("Under Hood", "SPARK PLUGS", [("spark_plug", N, "Yes", "gasoline engine"), ("ignition_coil", N, "No", "gasoline engine")], None),
    ("Under Hood", "CABIN AIR FILTER", [("cabin_air_filter", N, "Yes", "cabin filter equipped")], None),
    ("Under Hood", "FUEL SYSTEM", [("fuel_line", N, "No", "combustion engine"), ("fuel_filter", N, "No", "serviceable fuel filter"), ("fuel_injector", N, "No", "combustion engine")],
     "The example note is service history ('serviced at 162,292'); Wrynch stores that as a service_event, not a condition."),
    ("Under Car", "LF TIRE", [("tire", ["left_front"], "Yes", A), ("wheel", ["left_front"], "No", A), ("tire_valve_stem", ["left_front"], "No", A)], None),
    ("Under Car", "RF TIRE", [("tire", ["right_front"], "Yes", A), ("wheel", ["right_front"], "No", A), ("tire_valve_stem", ["right_front"], "No", A)], None),
    ("Under Car", "VISUAL BRAKE SYSTEM CONDITION",
     [("brake_pad", F2, "Yes", A), ("brake_rotor", F2, "Yes", A), ("brake_caliper", F2, "No", A),
      ("brake_pad", R2, "Yes", "rear disc brakes"), ("brake_rotor", R2, "Yes", "rear disc brakes"), ("brake_caliper", R2, "No", "rear disc brakes"),
      ("brake_shoe", R2, "Yes", "rear drum brakes"), ("brake_drum", R2, "Yes", "rear drum brakes"),
      ("brake_hose", C4, "No", A), ("brake_line", N, "No", A)],
     "One shop point, up to 20 components. Pads/rotors each get a measured value per corner."),
    ("Under Car", "SUSPENSION COMPONENTS (SHOCKS, STRUTS, CONTROL ARMS, BALL JOINTS, ETC)",
     [("strut_assembly", F2, "Yes", "front struts"), ("shock_absorber", F2, "Yes", "front shocks (non-strut)"), ("shock_absorber", R2, "Yes", "rear shocks"),
      ("strut_assembly", R2, "Yes", "rear struts"), ("coil_spring", C4, "No", "coil springs"), ("leaf_spring", R2, "No", "rear leaf springs"),
      ("control_arm", C4, "No", A), ("ball_joint", F2, "Yes", A), ("sway_bar_link", C4, "No", A), ("suspension_bushing", C4, "No", A), ("strut_mount", F2, "No", "front struts")],
     "Upper vs lower ball joint / control arm is stored as subtype (e.g. ball_joint @ left_front, subtype upper)."),
    ("Under Car", "STEERING COMPONENTS (TIE RODS, STEERING GEAR, ETC.)",
     [("outer_tie_rod_end", LR, "Yes", A), ("inner_tie_rod", LR, "Yes", "rack-and-pinion"), ("steering_rack_boot", LR, "No", "rack-and-pinion"),
      ("steering_rack", N, "No", "rack-and-pinion"), ("steering_gearbox", N, "No", "recirculating-ball steering"), ("idler_arm", N, "No", "parallelogram linkage"),
      ("pitman_arm", N, "No", "parallelogram linkage"), ("center_link", N, "No", "parallelogram linkage")], None),
    ("Under Car", "DRIVELINE COMPONENTS (CV AXLES, DRIVESHAFTS, ETC.)",
     [("cv_axle", F2, "Yes", "FWD/AWD"), ("cv_boot", F2, "Yes", "FWD/AWD"), ("cv_axle", R2, "No", "independent rear drive"), ("cv_boot", R2, "No", "independent rear drive"),
      ("driveshaft", ["front", "rear"], "No", "RWD/AWD/4WD"), ("universal_joint", N, "No", "RWD/AWD/4WD"), ("driveshaft_support_bearing", N, "No", "two-piece driveshaft")], None),
    ("Under Car", "FLUID LEAKS NOTICED",
     [("engine_assembly", N, "Yes", "combustion engine"), ("engine_oil_pan", N, "No", "combustion engine"), ("transmission_pan", N, "No", "automatic transmission"),
      ("axle_housing", N, "No", "solid axle")],
     "A sweep point: a leak that is found is recorded on the component that is leaking."),
    ("Under Car", "FRONT DIFFERENTIAL", [("differential_fluid", ["front"], "Yes", "4WD/AWD front differential"), ("differential_housing", ["front"], "No", "4WD/AWD front differential")], None),
    ("Under Car", "EXHAUST SYSTEM", [("exhaust_pipe", N, "Yes", "combustion engine"), ("catalytic_converter", N, "Yes", "combustion engine"), ("muffler", N, "No", "combustion engine"),
                                     ("exhaust_hanger", N, "No", "combustion engine"), ("exhaust_sensor", N, "No", "combustion engine")], None),
    ("Under Car", "TRANSFER CASE", [("transfer_case_fluid", N, "Yes", "4WD/AWD with transfer case"), ("transfer_case", N, "No", "4WD/AWD with transfer case")], None),
    ("Under Car", "REAR DIFFERENTIAL", [("differential_fluid", ["rear"], "Yes", "rear differential"), ("differential_housing", ["rear"], "No", "rear differential")], None),
    ("Under Car", "LR TIRE", [("tire", ["left_rear"], "Yes", A), ("wheel", ["left_rear"], "No", A), ("tire_valve_stem", ["left_rear"], "No", A)], None),
    ("Under Car", "RR TIRE", [("tire", ["right_rear"], "Yes", A), ("wheel", ["right_rear"], "No", A), ("tire_valve_stem", ["right_rear"], "No", A)], None),
    # Added by Wrynch (not on the shop's paper MPI): applies only to electrified vehicles, so it never shows on a gas car.
    ("EV / Hybrid", "HIGH-VOLTAGE BATTERY", [("high_voltage_battery_pack", N, "Yes", "EV/PHEV/HEV")],
     "Visual from a safe distance plus scan-tool state of health. Never open or probe high-voltage parts during an MPI."),
    ("EV / Hybrid", "HIGH-VOLTAGE CABLES", [("high_voltage_cable", N, "Yes", "EV/PHEV/HEV")], "Orange cabling: visual only."),
    ("EV / Hybrid", "CHARGE PORT", [("charge_port_inlet", [p], "Yes", "charge port " + p.replace("_", " ")) for p in ("left_front", "right_front", "left_rear", "right_rear", "front", "rear")]
     + [("charge_port_door", N, "No", "BEV/PHEV")], "The vehicle setup records where the charge port is; only that position applies."),
    ("EV / Hybrid", "ELECTRIC DRIVE UNITS", [("electric_drive_unit", ["front"], "Yes", "BEV front motor"), ("electric_drive_unit", ["rear"], "Yes", "BEV rear motor")], None),
]

SHOP_POINTS, SHOP_MAP = [], []
for i, (sec, name, comps, note) in enumerate(SHOP, 1):
    pid = f"S{i:02d}"
    n = 0
    for cls, poss, req, when in comps:
        c = BY_NAME[cls]
        for pos in poss:
            n += 1
            SHOP_MAP.append([pid, sec, name, c["id"], cls, pos or (c.get("implied_position") or ""), req, when,
                             " | ".join(c["check_keys"])])
    if not comps:
        SHOP_MAP.append([pid, sec, name, None, "(vehicle_concern — symptom, not a component)", "", "Yes", A, "—"])
    SHOP_POINTS.append([pid, sec, name, n, note])

# -------------------------------------------------------------- worked example (real inspection)
G, Y, X = "ok (green)", "monitor (yellow)", "not inspected (gray)"


def rt(cls, key, sev):
    r = next(x for x in CLASS_FINDINGS if x["cname"] == cls and x["key"] == key)
    return r[sev]


# shop point, tech wrote, their rating, component (class @ position), finding / measurement, Wrynch rating, agrees?, what changes
EX = [
    ("BATTERY", "rating 800cca. tested 601cca", Y, "low_voltage_battery", "measured_cca = 601 of 800 = 75%", "monitor", "Yes", "Stored as a measurement, so next visit shows the trend (e.g. 75% → 68%)."),
    ("TIMING BELT/CHAIN", "Not inspected due to component location", X, "timing_belt or timing_chain (from vehicle config)", "not_inspected, reason = not_accessible", "not_inspected", "Yes", "Reason is a coded value, so reports can show why."),
    ("SPARK PLUGS", "(no note)", G, "spark_plug", "no findings", "ok", "Yes", None),
    ("CABIN AIR FILTER", "What not inspected during this visit", X, "cabin_air_filter", "not_inspected, reason = not_performed_this_visit", "not_inspected", "Yes", "Coded reason replaces free text (and the typo)."),
    ("FUEL SYSTEM", "serviced at 162,292miles. No concerns", G, "fuel_injector / fuel_line", "service_event: fuel system service @ 162,292 mi; no findings", "ok", "Yes", "Service history is stored as data, not buried in a comment."),
    ("HOOD LATCH AND CABLES", "Functions well", G, "hood_latch", "hood_latch.secondary = pass", "ok", "Yes", None),
    ("ENGINE OIL", "Over full. OK condition", Y, "engine_oil", "level = slightly above FULL (overfilled, minor); condition = normal", "monitor", "Yes", "Level and condition become two check results."),
    ("ENGINE COOLANT", "coolant condition looks older. recommend flush, p0128 thermostat is not functioning...", Y, "engine_coolant + thermostat",
     f"engine_coolant: degraded_fluid (minor) → {rt('engine_coolant','degraded_fluid','minor')}; thermostat: failed_test (P0128) → {rt('thermostat','failed_test','minor')}", "monitor (both)", "Yes",
     "One note becomes two component records plus a stored DTC; the thermostat gets its own history."),
    ("TRANSMISSION FLUID", "Clean and at a proper level. changed at 160,292 miles", G, "automatic_transmission_fluid", "level_condition = in range; service_event @ 160,292 mi", "ok", "Yes", None),
    ("POWER STEERING FLUID", "At a good level", G, "power_steering_fluid", "level_condition = in range", "ok", "Yes", None),
    ("BRAKE FLUID", "recommend flush", Y, "brake_fluid", "No test value recorded", "monitor (pending test)", "Partly",
     "Wrynch would ask for the copper-strip value: < 100 ppm OK, 100–199 Monitor, ≥ 200 Immediate. A recommendation without a measurement is flagged."),
    ("HOSES AND BELTS", "No concerns", G, "accessory_drive_belt, coolant_hose, …", "no findings", "ok", "Yes", None),
    ("AIR FILTER", "air box broken and DIY strap was done. could not check filter status", X, "engine_air_filter_housing + engine_air_filter",
     f"housing: broken (moderate) → {rt('engine_air_filter_housing','broken','moderate')}; filter: unable_to_assess, reason = blocked_by_other_condition", "monitor + unable_to_assess", "No",
     "The shop's gray hides a real finding (broken air box). Wrynch records the damage on the housing."),
    ("INSTRUMENT CLUSTER PHOTOS", "CEL illuminated", Y, "warning_indicator (subtype check_engine)", "warning_indicator.status = check_engine steady; DTCs P0128, P0420", "monitor", "Yes", "DTCs are stored and linked to the thermostat and catalytic converter."),
    ("WIPER BLADES", "Function well", G, "wiper_blade @ left_front, right_front", "wipe = clean sweep", "ok", "Yes", None),
    ("HVAC PERFORMANCE", "AC inoperative, found ac clutch smoking when ac command on. possible ac compr...", Y, "ac_compressor",
     "inoperative + heat_damage (clutch smoking)", "monitor", "Yes",
     "A/C is a comfort item, so it stays yellow. It turns red only if the compressor seizes and stops or shreds the drive belt."),
    ("NOISE, VIBRATION, OR PULLING NOTICED", "Not driven during this visit due to check engine light codes", X, "vehicle_concern", "not_inspected, reason = vehicle_not_road_tested", "not_inspected", "Yes", None),
    ("POWERTRAIN PERFORMANCE", "No noted concerns passed customer complaints", X, "engine_assembly / vehicle_concern", "not_inspected, reason = vehicle_not_road_tested", "not_inspected", "Yes", "Customer complaint stored as a vehicle_concern."),
    ("HORN AND EXTERIOR LIGHTS", "All exterior lights and horn function properly", G, "horn + 20 lamp components", "operation = pass on each", "ok", "Yes", "Each lamp gets its own OK record."),
    ("ENGINE CRANKING", "Normal Cranking", G, "starter_motor", "crank = normal", "ok", "Yes", None),
    ("WALKAROUND, VIN, AND TIRE PLACARD PHOTOS", "Good condition", G, "vehicle_exterior, vin_label, tire_placard", "no findings", "ok", "Yes", None),
    ("LF TIRE", "5/32 getting low on tread", Y, "tire @ left_front", "tread_depth = 5/32", "monitor", "Yes", None),
    ("RF TIRE", "5/32 getting low on tread", Y, "tire @ right_front", "tread_depth = 5/32", "monitor", "Yes", None),
    ("LR TIRE", "5/32 tread left", Y, "tire @ left_rear", "tread_depth = 5/32", "monitor", "Yes", None),
    ("RR TIRE", "5/32 Tread left. Dry rot present. Recommend replacing", Y, "tire @ right_rear", f"tread_depth = 5/32; dry_rot (moderate) → {rt('tire','dry_rot','moderate')}", "monitor", "Yes", None),
    ("VISUAL BRAKE SYSTEM CONDITION", "fronts 5mm/rotors major grooving. rears 6mm", Y, "brake_pad @ LF, RF", "lining_thickness = 5 mm", "ok", "No",
     "Pads alone are OK (≥ 5 mm). The point went yellow because of the rotors; Wrynch keeps the pads' own OK record."),
    ("VISUAL BRAKE SYSTEM CONDITION", "(same note)", Y, "brake_rotor @ LF, RF", f"grooved, 'major' → severe → {rt('brake_rotor','grooved','severe')}", "monitor", "Yes",
     "Even major grooving is yellow unless a measurement shows the rotor below its embossed minimum, which is the shop's red line."),
    ("VISUAL BRAKE SYSTEM CONDITION", "(same note)", Y, "brake_pad @ LR, RR", "lining_thickness = 6 mm", "ok", "Yes", "Rear pads get their own OK record instead of inheriting the point's yellow."),
    ("SUSPENSION COMPONENTS", "LF upper ball joint torn boot, both rear shocks starting to leak", Y, "ball_joint @ left_front (subtype upper)", f"damaged_seal (moderate) → {rt('ball_joint','damaged_seal','moderate')}", "monitor", "Yes", "Before this recalibration the default would have forced Immediate."),
    ("SUSPENSION COMPONENTS", "(same note)", Y, "shock_absorber @ left_rear, right_rear", f"seepage (minor) → {rt('shock_absorber','seepage','minor')}", "monitor", "Yes", "Two separate shock records, each with its own timeline."),
    ("STEERING COMPONENTS", "both outer tie rod boot starting to show early signs of cracking", Y, "outer_tie_rod_end @ left, right", f"damaged_seal (minor) → {rt('outer_tie_rod_end','damaged_seal','minor')}", "monitor", "Yes", None),
    ("DRIVELINE COMPONENTS", "Ok at this time", G, "cv_axle/cv_boot/driveshaft", "no findings", "ok", "Yes", None),
    ("FLUID LEAKS NOTICED", "No leaks noted", G, "engine_assembly …", "leaks = dry", "ok", "Yes", None),
    ("FRONT DIFFERENTIAL", "Flushed at 164,149 miles", G, "differential_fluid @ front", "service_event @ 164,149 mi", "ok", "Yes", None),
    ("EXHAUST SYSTEM", "p0420, catalytic converter(s) has loss its efficiency and will need to be replaced.", Y, "catalytic_converter", f"failed_test (DTC P0420, moderate) → {rt('catalytic_converter','failed_test','moderate')}", "monitor", "Yes", "Before recalibration this would have been Immediate."),
    ("TRANSFER CASE", "Recommend flushing due to mileage and no records of service", G, "transfer_case_fluid", f"service_due (no records) → {rt('transfer_case_fluid','service_due','minor')}", "monitor", "No",
     "The shop rated green while recommending service. Wrynch derives the rating from the finding, so a recommendation can't sit under a green."),
    ("REAR DIFFERENTIAL", "Flushed at 164,169 miles.", G, "differential_fluid @ rear", "service_event @ 164,169 mi", "ok", "Yes", None),
]
