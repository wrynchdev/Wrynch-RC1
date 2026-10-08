"""Finding vocabulary additions, finding groups, class→finding applicability with ratings."""
from base import finding_rows, log
from classes2 import CLASSES, BY_NAME

FINDINGS = [dict(key=r[0], scope=r[1], definition=r[2], evidence=r[3], notes=r[4], added_in="1.0.0") for r in finding_rows]
NEW_FINDINGS = [
    ("warning_indicator_on", "dashboard", "A warning indicator remains illuminated with the engine running.", "Cluster photo / scan data", "Rating depends on which indicator (warning_indicator subtype)."),
    ("low_pressure", "tire/system", "Measured pressure is below the applicable specification.", "Measurement", "Record as-found value before adjusting."),
    ("over_pressure", "tire/system", "Measured pressure is above the applicable specification.", "Measurement", "Record as-found value before adjusting."),
    ("aged", "tire/rubber/battery", "Component age (date code or install date) exceeds the recommended service life.", "Date-code photo", "Age alone is not a visible defect; pair with condition."),
    ("exposed_cord", "tire", "Tire cords/belts are visible through tread or sidewall.", "Close photo", "Always immediate attention."),
    ("dim", "lighting", "Lamp operates but output is visibly reduced.", "Functional check / photo", None),
    ("misaimed", "lighting/sensor", "Beam or sensor aim is visibly outside the expected pattern.", "Aim check", None),
    ("streaking", "wiper", "Wiper leaves streaks, smears or chatters.", "Functional check", None),
    ("failed_test", "universal", "Component failed an instrument or functional test (tester, gauge, strip, pressure test, scan).", "Test result photo / measurement", "Store the test and result as a check result."),
    ("service_due", "universal", "Scheduled service interval (miles/time) is reached or exceeded.", "Service history / oil-life monitor", "Not a visible defect; driven by interval data."),
    ("discharged", "battery", "Battery state of charge is low; recharge and retest before condemning.", "Voltage / tester", None),
    ("sagging", "suspension/body", "Component or ride height sits visibly lower than expected.", "Photo / ride-height measurement", "Prefer measured ride height against spec."),
    ("degraded_fluid", "fluid", "Fluid is dark, burnt, sludgy, milky or otherwise degraded.", "Dipstick/reservoir photo / test strip", "Contamination by another fluid → use contaminated."),
    ("poor_performance", "functional", "System operates but below the expected output (e.g. A/C vent temperature, heater output).", "Measurement", None),
]
for k, s, d, e, n in NEW_FINDINGS:
    FINDINGS.append(dict(key=k, scope=s, definition=d, evidence=e, notes=n, added_in="1.1.0"))
log("Condition Findings", "New finding keys", f"{len(finding_rows)} keys", f"{len(FINDINGS)} keys",
    "Added findings needed for measured/functional checks (pressure, age, test failure, service due, warning lamps, fluid condition).")

COSMETIC = {"dent", "scratch", "scuff", "chip", "paint_damage", "clearcoat_damage", "fading", "peeling",
            "previous_repair", "overspray", "discolored", "abrasion", "gouge", "debris_buildup"}
ALWAYS_IMMEDIATE = {"exposed_cord", "exposed_conductor", "burn_damage", "melted", "shattered", "bulge"}
SAFETY_IMMEDIATE = {"broken", "missing", "inoperative", "excessive_play", "out_of_spec",
                    "disconnected", "unsecured", "binding", "separated", "failed_test"}
I4 = ("immediate_attention",) * 4
FINDING_OVERRIDE = {  # (class, finding): (minor, moderate, severe, critical), note
    **{("seat_belt", k): (I4, "Seat belt webbing damage is always immediate attention.") for k in ("frayed", "torn", "cut")},
    **{("brake_hose", k): (I4, "Brake hose cut/torn through the cover is immediate attention.") for k in ("cut", "torn")},
    ("cv_boot", "torn"): (("monitor", "immediate_attention", "immediate_attention", "immediate_attention"), "Small tear = monitor; split with grease loss (moderate+) = immediate."),
    ("tire", "punctured"): (("monitor", "immediate_attention", "immediate_attention", "immediate_attention"), "Repairable tread puncture = monitor; sidewall/shoulder or non-repairable = immediate."),
    ("tire", "cut"): (("monitor", "immediate_attention", "immediate_attention", "immediate_attention"), "Shallow tread nick = monitor; deeper or sidewall cut = immediate."),
}

# ---- finding groups
G = {
 "BODY": "dent scratch scuff chip crack broken bent deformation loose missing misaligned rust corrosion paint_damage clearcoat_damage fading peeling previous_repair overspray damaged unsecured gouge abrasion punctured",
 "TRIM": "scratch scuff crack broken loose missing fading peeling discolored damaged unsecured bent dent chip",
 "GLASS": "chip crack shattered pitting delamination scratch water_intrusion damaged_seal missing broken obstructed damaged",
 "LAMP": "crack broken cloudy water_intrusion inoperative intermittent dim misaimed missing discolored loose damaged",
 "RUBBER": "crack torn cut dry_rot swollen collapsed chafed leak seepage residue damaged missing deformation abrasion aged",
 "METAL": "bent crack broken rust corrosion damaged loose deformation missing",
 "JOINT": "excessive_play loose binding abnormal_noise damaged_seal rust corrosion damaged bent broken worn",
 "FLUIDCOMP": "leak seepage residue crack damaged corrosion loose missing contaminated",
 "FLUID": "low_level overfilled contaminated degraded_fluid discolored failed_test service_due",
 "ELEC": "corrosion loose disconnected exposed_conductor connector_damage melted burn_damage chafed cut damaged inoperative intermittent failed_test",
 "ROT": "abnormal_noise excessive_play binding leak seepage loose inoperative damaged worn failed_test",
 "FRICTION": "worn excessive_wear uneven_wear glazed scored grooved crack heat_damage contaminated rust corrosion out_of_spec damaged missing",
 "EXHAUST": "leak rust corrosion broken crack loose missing damaged heat_damage abnormal_noise punctured unsecured disconnected",
 "TIRE": "low_tread uneven_wear bulge cut punctured dry_rot crack low_pressure over_pressure aged damaged exposed_cord abrasion missing",
 "WHEEL": "bent crack broken corrosion scratch gouge damaged missing loose",
 "BELT": "crack frayed glazed worn excessive_wear chafed damaged loose misaligned abnormal_noise contaminated torn missing",
 "FILTER": "contaminated debris_buildup obstructed damaged missing water_intrusion service_due",
 "CONTEXT": "unreadable damaged missing obstructed",
 "FUNC": "inoperative intermittent binding abnormal_noise failed_test",
 "HV": "damaged chafed exposed_conductor connector_damage leak corrosion heat_damage failed_test loose unsecured crack dent melted burn_damage",
 "ADAS": "obstructed misaligned misaimed damaged crack inoperative failed_test missing loose",
 "BELTSAFE": "frayed torn cut inoperative binding damaged worn missing contaminated",
 "SEAT": "torn worn damaged loose inoperative binding contaminated stained",
 "INTERVAL": "service_due",
}
G = {k: v.split() for k, v in G.items()}

CAT_GROUPS = {
 "identity_context": ["CONTEXT"], "wheels_tires": ["TIRE"], "wheel_end": ["ROT", "METAL"],
 "controls_context": ["FUNC", "CONTEXT", "damaged crack".split()],
 "lighting": ["LAMP"], "electrical": ["ELEC", "FUNC"], "hood_hardware": ["METAL", "FUNC"],
 "engine_oil": ["FLUIDCOMP"], "cooling": ["FLUIDCOMP", "RUBBER"], "transmission": ["FLUIDCOMP"],
 "power_steering": ["FLUIDCOMP", "ROT"], "brake_hydraulics": ["FLUIDCOMP", "FUNC"],
 "hoses_belts": ["RUBBER"], "air_intake": ["FILTER", "crack loose damaged".split()], "battery": ["ELEC", "crack swollen leak aged discharged".split()],
 "timing": ["BELT", "INTERVAL"], "ignition": ["ELEC", "INTERVAL", "worn contaminated".split()],
 "cabin_filtration": ["FILTER"], "fuel_system": ["FLUIDCOMP", "RUBBER"], "brakes": ["FRICTION", "FLUIDCOMP"],
 "suspension": ["METAL", "JOINT", "RUBBER"], "steering": ["METAL", "JOINT", "FLUIDCOMP"],
 "driveline": ["METAL", "JOINT", "RUBBER"], "powertrain_underbody": ["FLUIDCOMP", "METAL"], "exhaust": ["EXHAUST"],
 "body_panel": ["BODY"], "closure": ["BODY", "FUNC", "water_intrusion damaged_seal".split()], "fascia": ["BODY"], "aero": ["BODY"],
 "glass": ["GLASS"], "roof": ["BODY", "torn water_intrusion damaged_seal".split()], "mirror": ["TRIM", "GLASS"], "trim": ["TRIM"],
 "protection": ["TRIM", "METAL"], "hardware": ["TRIM", "FUNC"], "towing": ["METAL", "ELEC"], "roof_cargo": ["TRIM", "METAL"],
 "pickup": ["TRIM", "BODY"], "cargo": ["TRIM"], "commercial_rv": ["BODY", "TRIM"], "commercial": ["TRIM", "METAL"],
 "step_guard": ["TRIM", "METAL"], "fluids": ["FLUID"], "washer_wiper": ["FUNC", "FLUIDCOMP"],
 "charging_starting": ["ELEC", "ROT"], "hvac": ["FLUIDCOMP", "ROT", "poor_performance".split()],
 "occupant_safety": ["BELTSAFE"], "cabin": ["SEAT"], "cabin_controls": ["FUNC", "excessive_play worn damaged loose".split()],
 "adas": ["ADAS"], "ev_high_voltage": ["HV"], "engine": ["FLUIDCOMP", "abnormal_noise failed_test inoperative heat_damage".split()],
}
CLASS_EXTRA = {
 "wiper_blade": "streaking torn worn cracked missing damaged dry_rot", "wiper_arm": "bent broken loose missing corrosion",
 "horn": "inoperative intermittent", "instrument_cluster": "warning_indicator_on",
 "warning_indicator": "warning_indicator_on", "low_voltage_battery": "failed_test",
 "brake_rotor": "pitting", "brake_caliper": "binding leak seepage damaged_seal", "brake_hose": "RUBBER",
 "brake_line": "leak rust corrosion kinked chafed damaged", "parking_brake_cable": "binding frayed rust corrosion excessive_play",
 "shock_absorber": "leak seepage bent damaged_seal", "strut_assembly": "leak seepage bent damaged_seal",
 "coil_spring": "sagging", "leaf_spring": "sagging", "air_spring": "leak sagging", "strut_mount": "RUBBER",
 "cv_boot": "RUBBER", "steering_rack_boot": "RUBBER", "suspension_bushing": "RUBBER", "sway_bar_bushing": "RUBBER",
 "powertrain_mount": "RUBBER", "driveshaft_flex_disc": "RUBBER", "bump_stop": "RUBBER",
 "tire_valve_stem": "crack dry_rot leak missing damaged bent", "spare_tire": "TIRE",
 "wheel_lug_nut": "missing loose damaged corrosion out_of_spec", "wheel_hub_bearing": "excessive_play abnormal_noise binding failed_test",
 "coolant_pressure_cap": "failed_test damaged_seal", "radiator": "debris_buildup obstructed", "ac_condenser": "debris_buildup obstructed bent",
 "accessory_drive_belt": "failed_test", "timing_belt": "service_due", "spark_plug": "service_due worn contaminated",
 "headlamp": "cloudy dim misaimed", "side_mirror_glass": "GLASS", "windshield": "scratch pitting",
 "high_voltage_battery_pack": "dent failed_test warning_indicator_on", "fuel_cap": "damaged_seal missing",
 "trailer_hitch_receiver": "crack rust bent", "seat_belt": "BELTSAFE",
 "hood_latch": "binding inoperative", "backup_camera": "obstructed inoperative intermittent damaged",
 "tpms_sensor": "failed_test inoperative damaged", "cabin_air_vent": "poor_performance obstructed",
 "hvac_control_panel": "inoperative intermittent", "engine_assembly": "leak seepage residue abnormal_noise",
 "differential_housing": "leak seepage",
 "catalytic_converter": "failed_test", "exhaust_sensor": "failed_test inoperative", "engine_air_filter_housing": "broken unsecured",
 "ac_compressor": "heat_damage", "transfer_case": "leak seepage", "brake_pedal": "failed_test",
}
VALID = {f["key"] for f in FINDINGS}
# words used above that are not vocabulary keys get mapped
ALIASES = {"cracked": "crack", "kinked": "deformation", "separated": None, "stained": "contaminated", "dent": "dent"}


def expand(tokens):
    out = []
    for t in tokens:
        if t in G:
            out += G[t]
        else:
            out.append(t)
    res = []
    for t in out:
        t = ALIASES.get(t, t)
        if t and t in VALID and t not in res:
            res.append(t)
        elif t and t not in VALID:
            raise ValueError("unknown finding " + t)
    return res


def ratings(cls, key):
    """Default rating at minor, moderate, severe, critical.
    Shop definition: Immediate Attention (red) = the component no longer performs to minimum legal/OEM standards and
    needs replacing now. Worn or degraded but still meeting the minimum = Monitor."""
    safety = cls["safety_critical"]
    cat = cls["category"]
    M, I = "monitor", "immediate_attention"
    if (cls["name"], key) in FINDING_OVERRIDE:
        return FINDING_OVERRIDE[(cls["name"], key)]
    if key in ALWAYS_IMMEDIATE:
        return (I,) * 4, "Fails minimum standard whenever present."
    if key == "leak" and cat in {"brakes", "brake_hydraulics", "fuel_system", "exhaust", "ev_high_voltage"}:
        return (I,) * 4, "Any leak in a brake, fuel, exhaust or high-voltage system fails minimum standards."
    if key == "crack" and (cat in {"wheels_tires", "suspension", "steering", "wheel_end", "driveline"} or cls["name"] in ("brake_rotor", "brake_drum", "brake_caliper", "brake_backing_plate")) and cls["name"] not in ("cv_boot", "steering_rack_boot", "suspension_bushing", "sway_bar_bushing", "strut_mount", "bump_stop", "tire", "spare_tire", "tire_valve_stem"):
        return (I,) * 4, "Structural crack in a load-bearing part."
    if key in COSMETIC and cat != "glass":
        return ("ok", M, M, I), "Cosmetic: documented; minor is OK-noted."
    if safety and key in SAFETY_IMMEDIATE:
        return (I,) * 4, "Safety part that is broken, missing, inoperative, out of spec or loose no longer meets minimum standards."
    return (M, M, M, I), "Worn/degraded but still meets minimum → Monitor. Immediate only at critical severity or when a measured check fails its minimum."


RUBBER_PARTS = ["cv_boot", "steering_rack_boot", "suspension_bushing", "sway_bar_bushing", "strut_mount",
                "powertrain_mount", "bump_stop", "driveshaft_flex_disc", "brake_hose", "coolant_hose", "vacuum_hose",
                "fuel_hose", "power_steering_hose"]
CLASS_SET = {n: "RUBBER" for n in RUBBER_PARTS}
for n in ["suspension_bushing", "sway_bar_bushing", "strut_mount", "powertrain_mount", "driveshaft_flex_disc"]:
    CLASS_SET[n] = "RUBBER excessive_play broken abnormal_noise"
CLASS_SET["coolant_hose"] = "RUBBER failed_test"
CLASS_SET["thermostat"] = "failed_test binding leak seepage damaged"
CLASS_SET.update({
 "brake_pad": "worn excessive_wear uneven_wear glazed crack heat_damage contaminated out_of_spec damaged missing",
 "brake_shoe": "worn excessive_wear uneven_wear glazed crack heat_damage contaminated out_of_spec damaged missing",
 "brake_rotor": "worn excessive_wear uneven_wear scored grooved crack heat_damage rust corrosion pitting out_of_spec damaged",
 "brake_drum": "worn excessive_wear uneven_wear scored grooved crack heat_damage rust corrosion out_of_spec damaged",
 "brake_caliper": "leak seepage binding damaged_seal corrosion rust damaged loose missing",
 "brake_wheel_cylinder": "leak seepage binding damaged_seal corrosion rust damaged",
 "brake_line": "leak rust corrosion deformation chafed damaged loose",
 "brake_backing_plate": "METAL",
 "parking_brake_cable": "binding frayed rust corrosion excessive_play damaged broken",
 "warning_indicator": "warning_indicator_on inoperative intermittent",
 "instrument_cluster": "inoperative intermittent warning_indicator_on unreadable damaged crack",
 "wiper_blade": "streaking torn worn crack missing damaged dry_rot",
 "wiper_arm": "bent broken loose missing corrosion damaged",
 "shock_absorber": "leak seepage residue bent damaged_seal broken damaged loose missing abnormal_noise worn corrosion rust failed_test",
 "strut_assembly": "leak seepage residue bent damaged_seal broken damaged loose missing abnormal_noise worn corrosion rust failed_test",
 "coil_spring": "broken crack sagging rust corrosion damaged missing",
 "leaf_spring": "broken crack sagging rust corrosion damaged missing loose",
 "air_spring": "leak crack dry_rot chafed sagging damaged torn broken",
 "torsion_bar": "METAL",
 "ball_joint": "JOINT", "outer_tie_rod_end": "JOINT", "inner_tie_rod": "JOINT", "sway_bar_link": "JOINT crack",
 "idler_arm": "JOINT", "pitman_arm": "JOINT", "center_link": "JOINT", "drag_link": "JOINT",
 "universal_joint": "JOINT", "driveshaft_support_bearing": "JOINT",
 "cv_axle": "excessive_play abnormal_noise bent damaged broken binding",
 "driveshaft": "bent damaged abnormal_noise excessive_play missing rust corrosion",
 "control_arm": "METAL excessive_play", "wheel": "WHEEL", "steering_knuckle": "METAL", "subframe": "METAL", "sway_bar": "METAL",
 "steering_rack": "leak seepage residue excessive_play binding abnormal_noise damaged",
 "steering_gearbox": "leak seepage residue excessive_play binding abnormal_noise damaged loose",
 "steering_shaft": "excessive_play binding abnormal_noise damaged",
 "steering_stabilizer": "leak seepage residue damaged loose missing",
 "tie_rod_adjusting_sleeve": "bent rust corrosion loose damaged",
 "axle_housing": "leak seepage residue bent crack damaged rust",
 "accessory_drive_belt": "BELT failed_test", "belt_tensioner": "ROT misaligned", "idler_pulley": "ROT misaligned",
 "water_pump": "leak seepage residue abnormal_noise excessive_play damaged",
 "low_voltage_battery": "corrosion crack swollen leak aged discharged failed_test damaged loose",
 "battery_terminal": "corrosion loose damaged melted burn_damage",
 "battery_cable": "corrosion loose damaged chafed cut exposed_conductor melted",
 "battery_hold_down": "loose missing corrosion broken damaged",
 "horn": "inoperative intermittent damaged",
 "tire_valve_stem": "crack dry_rot leak missing damaged bent",
 "radiator": "leak seepage residue crack damaged corrosion debris_buildup obstructed bent failed_test",
 "coolant_reservoir": "leak seepage residue crack damaged missing failed_test",
 "radiator_cooling_fan": "inoperative abnormal_noise damaged broken missing loose",
 "windshield_washer_pump": "inoperative intermittent obstructed damaged leak",
 "ac_condenser": "leak seepage residue damaged corrosion debris_buildup obstructed bent",
 "coolant_pressure_cap": "failed_test damaged_seal damaged missing",
 "engine_oil_fill_cap": "damaged_seal damaged missing loose",
 "fuel_cap": "damaged_seal damaged missing",
 "engine_oil_dipstick": "damaged missing bent", "transmission_dipstick": "damaged missing bent",
 "timing_belt": "BELT service_due", "timing_chain": "abnormal_noise service_due worn",
 "spark_plug": "worn contaminated damaged service_due", "ignition_coil": "ELEC",
 "headlamp": "LAMP", "tpms_sensor": "failed_test inoperative damaged missing",
 "wheel_hub_bearing": "excessive_play abnormal_noise binding failed_test damaged",
 "wheel_lug_nut": "missing loose damaged corrosion out_of_spec",
 "wheel_speed_sensor": "ELEC", "backup_camera": "obstructed inoperative intermittent damaged crack",
 "seat_belt": "BELTSAFE", "seat": "SEAT", "steering_wheel": "excessive_play binding damaged loose",
 "brake_pedal": "failed_test excessive_play binding damaged", "parking_brake_control": "failed_test excessive_play binding inoperative damaged",
 "brake_booster": "failed_test leak inoperative damaged", "brake_fluid_reservoir": "leak seepage crack damaged missing low_level",
 "high_voltage_battery_pack": "HV dent warning_indicator_on", "charge_port_inlet": "damaged burn_damage melted connector_damage debris_buildup corrosion",
})

# ---- 1.4.0: findings are recorded under checks, so every class lists only findings that part can actually have.
# The shared groups above gave many parts findings from other kinds of part (belt findings on a timing cover, bearing
# findings on a fluid reservoir, electrical findings on a tow hook). These lists replace the group lookup for those parts.
LAMP_COND = "crack broken cloudy water_intrusion inoperative intermittent dim missing discolored loose damaged"
CLASS_SET_14 = {
 # context and tires
 "vehicle_exterior": "dent scratch scuff chip crack broken missing paint_damage clearcoat_damage previous_repair rust damaged",
 "tire": "low_tread uneven_wear bulge cut punctured dry_rot crack low_pressure over_pressure aged damaged exposed_cord abrasion",
 "spare_tire": "low_tread uneven_wear bulge cut punctured dry_rot crack low_pressure over_pressure aged damaged exposed_cord abrasion",
 "wheel": "bent crack broken corrosion scratch gouge damaged",
 "tpms_sensor": "failed_test inoperative damaged missing corrosion",
 "wheel_hub_bearing": "excessive_play abnormal_noise binding damaged",
 # lamps (only headlamps and fog lamps are aimed)
 **{n: LAMP_COND for n in ["tail_lamp", "turn_signal_lamp", "reverse_lamp", "high_mount_brake_lamp", "license_plate_lamp", "side_marker_lamp"]},
 "headlamp": LAMP_COND + " misaimed", "fog_lamp": LAMP_COND + " misaimed",
 "interior_lamp": "inoperative intermittent dim crack broken cloudy missing loose damaged",
 # controls and hood hardware
 "cabin_air_vent": "broken binding loose missing obstructed crack damaged poor_performance",
 "hvac_control_panel": "inoperative intermittent binding unreadable crack missing damaged",
 "horn": "inoperative intermittent damaged loose corrosion disconnected",
 "warning_indicator": "warning_indicator_on inoperative",
 "hood_latch": "bent crack broken rust corrosion damaged loose missing inoperative binding",
 "hood_striker": "bent crack broken rust corrosion damaged loose misaligned worn",
 "hood_release_cable": "frayed broken binding inoperative damaged missing",
 # cooling
 "coolant_reservoir": "leak seepage residue crack damaged missing contaminated",
 "coolant_hose": "RUBBER",
 "thermostat_housing": "leak seepage residue crack damaged corrosion loose",
 "thermostat": "failed_test binding",
 # power steering and brake hydraulics
 "power_steering_reservoir": "leak seepage residue crack damaged loose missing contaminated",
 "brake_fluid_reservoir": "leak seepage crack damaged missing damaged_seal",
 "brake_master_cylinder": "leak seepage residue crack damaged corrosion loose",
 "brake_booster": "failed_test leak inoperative damaged corrosion",
 "brake_pedal": "failed_test excessive_play binding damaged worn",
 "parking_brake_control": "failed_test excessive_play binding inoperative",
 # belts and hoses
 "belt_tensioner": "abnormal_noise excessive_play binding loose damaged worn misaligned",
 "idler_pulley": "abnormal_noise excessive_play binding loose damaged crack misaligned",
 "vacuum_hose": "crack torn cut dry_rot swollen collapsed chafed leak damaged missing loose disconnected aged",
 "fuel_hose": "leak seepage crack cut dry_rot swollen chafed collapsed abrasion aged damaged loose",
 # air intake and cabin filtration
 "engine_air_filter": "contaminated debris_buildup obstructed damaged missing water_intrusion",
 "engine_air_filter_housing": "crack broken damaged loose missing unsecured water_intrusion debris_buildup",
 "engine_air_intake_duct": "crack torn collapsed loose damaged missing obstructed",
 "cabin_air_filter": "contaminated debris_buildup obstructed damaged missing water_intrusion",
 "cabin_air_filter_access_cover": "broken missing loose damaged crack",
 # battery and ignition
 "battery_terminal": "corrosion loose damaged melted burn_damage",
 "spark_plug_wire": "corrosion loose disconnected exposed_conductor connector_damage melted burn_damage chafed cut damaged crack",
 # timing
 "timing_chain": "abnormal_noise worn excessive_play damaged",
 "timing_cover": "leak seepage residue crack damaged loose missing",
 "timing_tensioner": "leak seepage worn excessive_play damaged broken",
 "timing_chain_guide": "worn crack broken damaged",
 # fuel system (rubber findings only where there is rubber)
 "fuel_tank": "leak seepage corrosion rust damaged deformation loose broken punctured",
 "fuel_filler_neck": "leak seepage corrosion rust crack damaged loose chafed",
 "fuel_line": "leak seepage corrosion rust chafed deformation damaged loose crack",
 "fuel_filter": "leak seepage residue crack damaged corrosion loose",
 "fuel_rail": "leak seepage residue crack damaged corrosion loose",
 "fuel_injector": "leak seepage residue crack damaged connector_damage loose",
 "fuel_pump": "leak seepage residue damaged corrosion connector_damage",
 # brakes
 "brake_hose": "RUBBER",
 # suspension and steering
 "shock_absorber": "leak seepage residue bent damaged_seal broken damaged loose abnormal_noise worn corrosion rust failed_test",
 "strut_assembly": "leak seepage residue bent damaged_seal broken damaged loose abnormal_noise worn corrosion rust failed_test",
 "coil_spring": "broken crack sagging rust corrosion damaged",
 "leaf_spring": "broken crack sagging rust corrosion damaged loose misaligned",
 "air_spring": "leak crack dry_rot chafed sagging damaged torn broken",
 "control_arm": "bent crack broken rust corrosion damaged loose deformation excessive_play",
 **{n: "crack torn cut dry_rot swollen collapsed deformation damaged missing aged excessive_play broken abnormal_noise"
    for n in ["suspension_bushing", "sway_bar_bushing"]},
 "strut_mount": "crack torn dry_rot collapsed deformation damaged missing aged excessive_play broken abnormal_noise binding loose",
 "powertrain_mount": "crack torn dry_rot collapsed deformation damaged missing aged excessive_play broken abnormal_noise leak",
 "steering_rack_boot": "crack torn cut dry_rot leak residue missing damaged aged abrasion",
 "cv_boot": "crack torn cut dry_rot leak residue missing damaged aged abrasion chafed",
 "steering_shaft": "excessive_play binding abnormal_noise damaged loose rust damaged_seal",
 "steering_stabilizer": "leak seepage residue damaged loose missing bent worn",
 "driveshaft_support_bearing": "JOINT torn crack",
 # exhaust
 **{n: "leak rust corrosion broken crack loose missing damaged heat_damage abnormal_noise punctured unsecured disconnected"
    for n in ["exhaust_manifold", "exhaust_pipe", "exhaust_flex_joint", "catalytic_converter", "muffler", "exhaust_resonator"]},
 "catalytic_converter": "leak rust corrosion broken crack loose missing damaged heat_damage abnormal_noise punctured unsecured disconnected failed_test",
 "exhaust_hanger": "broken damaged missing loose torn rust corrosion",
 "exhaust_heat_shield": "loose missing rust corrosion damaged broken abnormal_noise",
 "exhaust_clamp": "loose missing broken rust corrosion leak damaged",
 "exhaust_sensor": "damaged loose melted connector_damage chafed corrosion",
 # glass, mirrors, body
 "rear_window_glass": "GLASS inoperative",
 "side_mirror_housing": "scratch scuff crack broken loose missing fading peeling discolored damaged unsecured inoperative",
 "side_mirror_glass": "crack broken missing loose shattered pitting delamination inoperative damaged",
 "convertible_soft_top": "torn water_intrusion damaged_seal cloudy fading discolored binding broken damaged missing abrasion",
 "trunk_lid": "BODY inoperative intermittent binding water_intrusion damaged_seal sagging",
 "liftgate": "BODY inoperative intermittent binding water_intrusion damaged_seal sagging",
 "cowl_panel": "BODY obstructed debris_buildup",
 "grille": "BODY obstructed debris_buildup",
 "hood_scoop": "TRIM obstructed",
 "active_grille_shutter": "BODY inoperative binding",
 "closure_hinge": "worn rust corrosion loose binding abnormal_noise broken crack bent damaged",
 "exterior_lock_cylinder": "binding inoperative corrosion broken damaged missing loose",
 "exterior_door_handle": "broken loose missing inoperative binding damaged scratch scuff crack",
 "washer_nozzle": "obstructed misaimed crack broken missing damaged loose",
 "antenna": "bent broken crack loose missing damaged",
 "license_plate": "missing unreadable bent loose damaged",
 "license_plate_bracket": "crack broken missing loose damaged",
 "body_vent": "crack broken loose missing obstructed damaged",
 "bumper_step_pad": "worn torn crack loose missing damaged",
 "tow_hook": "bent crack broken rust corrosion damaged loose missing",
 "trailer_hitch_receiver": "bent crack broken rust corrosion damaged loose deformation",
 "tonneau_cover": "TRIM torn damaged_seal",
 "bed_step": "TRIM rust corrosion inoperative binding",
 "side_step": "TRIM rust corrosion deformation inoperative binding",
 "external_spare_tire_carrier": "rust corrosion frayed broken inoperative binding loose damaged bent",
 "roof_vent": "BODY inoperative damaged_seal",
 "luggage_compartment_door": "BODY damaged_seal",
 # fluids (discolored is a cosmetic word and rates OK at minor; a fluid's colour is degraded_fluid)
 "engine_oil": "low_level overfilled contaminated degraded_fluid service_due",
 "engine_coolant": "low_level overfilled contaminated degraded_fluid failed_test",
 "brake_fluid": "low_level overfilled contaminated degraded_fluid failed_test",
 "automatic_transmission_fluid": "low_level overfilled contaminated degraded_fluid",
 **{n: "low_level overfilled contaminated degraded_fluid service_due" for n in ["manual_transmission_fluid", "differential_fluid", "transfer_case_fluid"]},
 "power_steering_fluid": "low_level overfilled contaminated degraded_fluid",
 "windshield_washer_fluid": "low_level",
 "diesel_exhaust_fluid": "low_level contaminated degraded_fluid failed_test",
 # washer, wiper, HVAC, charging
 "windshield_washer_reservoir": "leak seepage crack damaged loose missing",
 "wiper_motor": "inoperative intermittent binding abnormal_noise poor_performance",
 "ac_refrigerant_line": "leak seepage residue crack damaged corrosion loose missing chafed deformation",
 "cabin_blower_motor": "inoperative intermittent abnormal_noise binding poor_performance",
 "alternator": "corrosion loose disconnected exposed_conductor connector_damage melted burn_damage chafed damaged inoperative failed_test abnormal_noise excessive_play contaminated crack",
 "starter_motor": "corrosion loose disconnected exposed_conductor connector_damage melted burn_damage chafed damaged inoperative intermittent abnormal_noise poor_performance contaminated crack",
 "seat_belt": "BELTSAFE",
 "adas_forward_camera": "ADAS", "adas_radar_sensor": "ADAS", "parking_sensor": "ADAS",
 "backup_camera": "obstructed inoperative intermittent damaged crack misaimed loose",
 # high voltage
 "engine_assembly": "leak seepage residue abnormal_noise failed_test inoperative heat_damage crack",
 "high_voltage_battery_pack": "damaged chafed exposed_conductor connector_damage leak corrosion heat_damage failed_test loose unsecured crack dent melted burn_damage deformation abrasion",
 "high_voltage_cable": "damaged chafed cut exposed_conductor connector_damage corrosion heat_damage loose unsecured missing melted burn_damage crack",
 "charge_port_inlet": "damaged burn_damage melted connector_damage debris_buildup corrosion damaged_seal",
}
CLASS_SET.update(CLASS_SET_14)
FINDING_OVERRIDE.update({
    ("tire_valve_stem", "missing"): (("monitor", "monitor", "monitor", "immediate_attention"), "A missing valve cap is Monitor; a missing or broken-off stem (critical) is Immediate."),
    **{("exhaust_heat_shield", k): (("monitor", "monitor", "monitor", "immediate_attention"), "A loose or missing heat shield rattles or exposes nearby parts to heat; it does not fail a minimum standard unless critical.")
       for k in ("broken", "missing", "loose")},
    ("exhaust_clamp", "missing"): (("monitor", "monitor", "monitor", "immediate_attention"), "A missing clamp is Monitor; the leak it causes is rated as a leak."),
    ("side_mirror_glass", "inoperative"): (("monitor", "monitor", "monitor", "immediate_attention"), "A power or manual adjuster that doesn't work is Monitor; the glass still gives a view."),
    ("high_voltage_cable", "missing"): (("monitor", "monitor", "monitor", "immediate_attention"), "A missing cable clip is Monitor; a chafed or exposed cable is Immediate."),
})
CLASS_FINDINGS = []
for c in CLASSES:
    toks = []
    if c["name"] in CLASS_SET:
        toks = CLASS_SET[c["name"]].split()
    else:
        for g in CAT_GROUPS.get(c["category"], ["BODY"]):
            toks += g if isinstance(g, list) else [g]
        if c["name"] in CLASS_EXTRA:
            toks += CLASS_EXTRA[c["name"]].split()
    if c["category"] != "fluids" and c["name"] not in CLASS_SET:
        toks.append("damaged")
    keys = expand(toks)
    base_keys = set() if c["name"] in CLASS_SET else set(expand([t for g in CAT_GROUPS.get(c["category"], ["BODY"]) for t in (g if isinstance(g, list) else [g])]))
    c["finding_keys"] = keys
    for k in keys:
        r, note = ratings(c, k)
        CLASS_FINDINGS.append(dict(cid=c["id"], cname=c["name"], key=k,
                                   source="category default" if k in base_keys else "class-specific",
                                   minor=r[0], moderate=r[1], severe=r[2], critical=r[3], note=note))

log("Class Findings", "Rating defaults recalibrated", "leak/torn/cut/failed_test = immediate at any severity on safety parts; non-safety functional loss = immediate at moderate",
    "Those findings now follow severity (minor/moderate = monitor, severe/critical = immediate), with explicit exceptions (brake/fuel/exhaust/HV leaks, seat belts, brake hoses, CV boots, tire cuts)",
    "Tested against the shop's real inspection: torn ball-joint boot, seeping shocks, P0420 cat and inoperative A/C were all rated Monitor by the tech; the old defaults would have forced Immediate.", "Yes", "1.2.0")
log("Class Findings", "Joint boots", "ball_joint / outer_tie_rod_end / sway_bar_link / driveshaft_support_bearing allowed 'torn'",
    "use 'damaged_seal' for a torn/cracked boot", "A torn boot is a seal finding; play in the joint is what makes it immediate (excessive_play).", "No", "1.2.0")

log("Class Findings", "Rating defaults: definition of red", "severe severity → Immediate",
    "Immediate only when the part no longer meets minimum legal/OEM standards: always-fail findings, safety parts broken/missing/inoperative/out of spec/loose, or critical severity. Everything else, including severe wear, is Monitor.",
    "Shop definition: red = needs changing now because the component no longer performs to minimum regulations.", "No", "1.2.0")

log("Class Findings", "crack on brake_rotor / brake_drum / brake_caliper / brake_backing_plate", "monitor (minor–severe)", "immediate at any severity",
    "A cracked rotor or drum no longer meets the minimum standard; caught by the app's test suite.", "No", "1.2.0")
