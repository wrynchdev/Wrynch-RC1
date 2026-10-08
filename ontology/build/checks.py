"""Condition checks per class: how each component is determined OK / Monitor / Immediate Attention (US units)."""
from findings import CLASSES, BY_NAME, FINDINGS
from lookfor import LOOK_FOR, REMOVE

SRC = {
    "TREAD": "S1, S2", "TPMS": "S3", "AGE": "S4", "BF": "S5", "STEER": "S6", "GLASS": "S7", "COOL": "S8",
    "BATT": "S9", "CHG": "S10", "DEF": "S11",
}
CHECKS = []


def ck(cls, key, name, method, reading, unit, vtype, better, ok, mon, imm, ok_lim=None, imm_lim=None,
       spec="Wrynch default (shop-configurable)", evidence="Photo", ai=None, fail="", basis="Industry practice; verify against OEM service information"):
    c = BY_NAME[cls]
    CHECKS.append(dict(cid=c["id"], cname=cls, key=f"{cls}.{key}", name=name, method=method, reading=reading,
                       unit=unit, vtype=vtype, better=better, ok=ok, mon=mon, imm=imm, ok_lim=ok_lim, imm_lim=imm_lim,
                       spec=spec, evidence=evidence, ai=ai if ai else c["ai_photo"], fail=fail, basis=basis))


# ---------------------------------------------------------------- tires & wheels
ck("tire", "tread_depth", "Tread depth (lowest main groove)", "measurement", "Tread depth gauge in the shallowest main groove", "32nds of an inch",
   "numeric", "higher", "≥ 6/32", "3/32 – 5/32", "≤ 2/32 (at the legal minimum; wear bars flush)", 6, 2,
   evidence="Photo of gauge in groove + value", ai="partial", fail="low_tread", basis="S13 (49 CFR 570.9: tread not less than 2/32), S1")
ck("tire", "tread_wear_pattern", "Tread wear pattern", "measurement", "Difference between inner and outer tread depth", "32nds of an inch",
   "numeric", "lower", "< 2/32 difference", "≥ 2/32 difference (suggest alignment check)", "Cords/belts visible or any groove ≤ 2/32", 2, None,
   fail="uneven_wear", basis="Industry practice")
ck("tire", "inflation_pressure", "Inflation pressure (as found, cold)", "measurement", "Gauge reading vs door placard", "psi",
   "numeric", "in_range", "Within 3 psi of placard", "More than 3 psi off placard as found (adjusted; 25%+ low suggests a leak)",
   "Will not hold air, or above the sidewall maximum", None, None, spec="Vehicle placard", evidence="Value (photo optional)",
   ai="no", fail="low_pressure | over_pressure", basis="S3 (TPMS warning threshold is 25% below placard)")
ck("tire", "age", "Tire age (DOT date code)", "measurement", "Years since the DOT week/year code", "years",
   "numeric", "lower", "< 6 years", "6 years or older (10+ strongly recommend replacement)", "— (age alone is not a failure; rate cracking/bulges on the structure check)", 6, None, evidence="Photo of DOT code", ai="yes",
   fail="aged", basis="S4 (many vehicle makers advise 6 years, tire makers 10 years maximum)")
ck("tire", "structure", "Sidewall and tread structure", "visual", "Bulges, cuts, punctures, cord exposure, dry rot", "—",
   "visual", "n/a", "No damage", "Light weather cracking; repairable puncture in tread area",
   "Bulge, exposed cord, sidewall cut/puncture, puncture not repairable", evidence="Photo", ai="yes",
   fail="bulge | exposed_cord | cut | punctured | dry_rot")
ck("spare_tire", "inflation_pressure", "Spare inflation pressure", "measurement", "Gauge reading vs placard (compact spares are often 60 psi)", "psi",
   "numeric", "in_range", "Within 3 psi of placard", "More than 3 psi low (adjusted)", "Flat or will not hold air", spec="Vehicle placard", ai="no", fail="low_pressure")
ck("spare_tire", "age", "Spare tire age", "measurement", "Years since DOT code", "years", "numeric", "lower", "< 6 years", "6 years or older", "— (rate structure instead)", 6, None, fail="aged", basis="S4")
ck("tire_valve_stem", "seal", "Valve stem condition", "visual", "Cracks, leaks (soap test), missing cap", "—", "visual", "n/a", "Intact, cap present",
   "Cap missing; minor cracking", "Leaking, cracked through, bent", fail="crack | leak | missing")
ck("tpms_sensor", "sensor_test", "TPMS sensor test", "test_equipment", "TPMS tool trigger: ID, pressure, battery status", "result",
   "pass_fail", "n/a", "Responds, battery OK", "Responds, low battery flagged", "No response or sensor fault", spec="Tester output", ai="no", evidence="Tool screen photo",
   fail="failed_test | inoperative")
ck("wheel", "condition", "Wheel condition", "visual", "Bends, cracks, curb damage", "—", "visual", "n/a", "No damage", "Curb rash/cosmetic damage",
   "Crack, bent rim, missing weight causing vibration", fail="bent | crack | broken")
ck("wheel_lug_nut", "security", "Lug nuts/bolts present and secure", "functional", "Count and torque check", "ft-lb",
   "pass_fail", "n/a", "All present, torqued to spec", "Corroded or damaged lock/nut still holding", "Any missing, loose, or damaged stud/thread",
   spec="Vehicle torque spec", fail="missing | loose | damaged", ai="yes")
ck("wheel_hub_bearing", "play_noise", "Hub/bearing play and noise", "functional", "12-and-6 rock test on lift; spin for noise; road test", "inches of play",
   "numeric", "lower", "No play, no noise", "Slight noise, no measurable play", "Measurable play beyond spec, grinding/roaring noise",
   spec="Vehicle spec", evidence="Video optional", ai="no", fail="excessive_play | abnormal_noise")

# ---------------------------------------------------------------- brakes
for cls, label in [("brake_pad", "Pad lining"), ("brake_shoe", "Shoe lining")]:
    okv, monv, immv = ("≥ 5 mm", "More than 2 mm and under 5 mm", "≤ 2 mm, wear indicator contacting, or at/below OEM minimum (federal floor: 1/32 in ≈ 0.8 mm over backing/rivets)") if cls == "brake_pad" else \
        ("≥ 3 mm", "More than 1 mm and under 3 mm", "≤ 1 mm over the shoe or rivet heads (federal floor 1/32 in ≈ 0.8 mm, 49 CFR 570.5), or at/below OEM minimum")
    ck(cls, "lining_thickness", f"{label} thickness", "measurement", "Thinnest pad/shoe lining (inner and outer)", "mm",
       "numeric", "higher", okv, monv, immv, 5 if cls == "brake_pad" else 3, 2 if cls == "brake_pad" else 1,
       evidence="Photo with gauge + value", ai="partial", fail="worn | excessive_wear | out_of_spec", basis="S14 (49 CFR 570.5 lining minimum); OEM minimum where published")
ck("brake_pad", "wear_pattern", "Inner/outer pad wear difference", "measurement", "Inner minus outer lining", "mm", "numeric", "lower",
   "< 2 mm difference", "≥ 2 mm difference (caliper slide/piston service suggested)", "Metal-to-metal on either pad", 2, None, fail="uneven_wear")
ck("brake_rotor", "thickness", "Rotor thickness vs minimum", "measurement", "Micrometer vs MIN TH stamped on rotor", "mm",
   "numeric", "higher", "More than 0.8 mm above minimum", "Within 0.8 mm of minimum", "At or below minimum (discard) thickness",
   spec="Vehicle spec (stamped MIN TH)", evidence="Value; photo of stamp", ai="no", fail="out_of_spec")
ck("brake_rotor", "surface", "Rotor surface", "visual", "Scoring, heat spots, cracks, rust ridge", "—", "visual", "n/a", "Smooth, even contact",
   "Scoring or grooving (incl. major), rust ridge, pulsation", "Crack, or grooves too deep to machine above minimum thickness", fail="scored | grooved | crack | heat_damage")
ck("brake_drum", "diameter", "Drum inside diameter vs maximum", "measurement", "Drum micrometer vs MAX DIA cast in drum", "mm",
   "numeric", "lower", "More than 0.8 mm below maximum", "Within 0.8 mm of maximum", "At or above maximum (discard) diameter",
   spec="Vehicle spec (cast MAX DIA)", ai="no", fail="out_of_spec")
for cls in ["brake_caliper", "brake_wheel_cylinder"]:
    ck(cls, "function_leak", "Leak and release check", "functional", "Wet seals; piston/slides free; wheel spins freely after release", "—",
       "pass_fail", "n/a", "Dry, releases freely", "Slides dry/sticky but releasing; boot cracked", "Fluid leak, seized piston or slides, dragging",
       fail="leak | binding | damaged_seal")
for cls in ["brake_hose", "brake_line"]:
    ck(cls, "integrity", "Line/hose integrity", "visual", "Leaks, swelling, cracking, chafing, heavy rust", "—", "visual", "n/a", "Intact",
       "Surface rust, minor weather cracks", "Any leak, swelling/bulge, chafed through cover, flaking/pitted steel line", fail="leak | swollen | chafed | corrosion")
ck("brake_fluid", "copper", "Brake fluid copper content", "test_equipment", "Test strip (copper corrosion inhibitor depletion)", "ppm",
   "numeric", "lower", "< 100 ppm", "100 – 199 ppm", "≥ 200 ppm (fluid replacement required)", 100, 200, spec="Test strip",
   evidence="Strip next to color chart", ai="partial", fail="failed_test | degraded_fluid", basis="S5 (MAP: replacement required at 200 ppm copper)")
ck("brake_fluid", "moisture", "Brake fluid moisture (alternative test)", "test_equipment", "Electronic moisture/boiling-point tester", "% water",
   "numeric", "lower", "< 2%", "2% – 2.9%", "≥ 3%", 2, 3, spec="Tester", ai="no", fail="failed_test")
ck("brake_fluid", "level", "Brake fluid level", "visual", "Level vs MIN/MAX on the reservoir; dark or cloudy fluid, debris in the reservoir", "—", "categorical", "n/a", "Between MIN and MAX",
   "At MIN (check pad wear/leaks)", "Below MIN", evidence="Photo of reservoir marks", ai="yes", fail="low_level")
ck("brake_pedal", "feel", "Brake pedal feel and height", "functional", "Engine running: firm pedal, no sink under steady pressure", "—",
   "categorical", "n/a", "Firm and high", "Slightly soft or low but holds", "Spongy, sinks, or near floor", ai="no", fail="failed_test")
ck("brake_booster", "assist", "Booster assist test", "functional", "Pump pedal engine off, start engine: pedal should drop slightly", "—", "pass_fail", "n/a",
   "Assist present, no hiss", "—", "No assist, hissing, or hard pedal", ai="no", fail="failed_test | leak")
ck("parking_brake_control", "hold", "Parking brake hold", "functional", "Applies within spec travel and holds vehicle", "clicks / travel", "pass_fail", "n/a",
   "Holds within normal travel", "Holds but excess travel (adjustment)", "Does not hold, or electric brake fault", ai="no", fail="failed_test | excessive_play")

# ---------------------------------------------------------------- steering & suspension
ck("steering_wheel", "free_play", "Steering wheel free play (lash)", "measurement", "Rim movement before front wheels move, engine running", "inches at rim",
   "numeric", "lower", "≤ 1 in", "More than 1 in and under the limit", "≥ 2 in on a 16 in wheel (2.25 in @18, 2.5 in @20, 2.75 in @22)", 1, 2,
   ai="no", fail="excessive_play", basis="S6 (49 CFR 570.7 lash limits)")
for cls in ["outer_tie_rod_end", "inner_tie_rod", "idler_arm", "pitman_arm", "center_link", "drag_link"]:
    ck(cls, "play", "Linkage free play", "functional", "Push-pull / dry-park check", "inches", "numeric", "lower", "No perceptible play",
       "Boot torn/cracked, or slight play under 1/4 in", "Linkage free play of 1/4 in or more", 0, 0.25, ai="no",
       fail="excessive_play | torn", basis="S6 (49 CFR 570.7: linkage free play ≤ 1/4 in)")
ck("ball_joint", "play", "Ball joint play", "measurement", "Dial indicator with joint unloaded/loaded per OEM, or wear indicator", "inches",
   "numeric", "lower", "Within OEM spec / indicator protruding", "Within spec but boot torn", "Exceeds OEM spec, or wear indicator flush/recessed",
   spec="Vehicle spec", ai="no", fail="excessive_play | torn")
for cls in ["shock_absorber", "strut_assembly"]:
    ck(cls, "leak", "Damper leak", "visual", "Oil wet on the damper body or dust boot (light misting is normal), dents in the body, broken mounts", "—", "categorical", "n/a", "Dry or light misting (normal)",
       "Oil film/wet body, no drip", "Oil running down body or dripping; bent or broken", ai="yes", fail="leak | seepage | bent")
    ck(cls, "damping", "Damping (bounce / road test)", "functional", "Bounce test and road test", "oscillations", "numeric", "lower",
       "Settles in ≤ 1 cycle", "1–2 cycles, or noticeable body float", "Continued bouncing; clunk from mount", 1, 2, ai="no",
       fail="failed_test | abnormal_noise")
for cls in ["coil_spring", "leaf_spring", "air_spring"]:
    ck(cls, "integrity", "Spring integrity and ride height", "visual", "Breaks, unseated coil, ride height vs spec", "inches", "categorical", "n/a",
       "Intact, ride height within spec", "Sagging / ride height below spec", "Broken, unseated, or air spring leaking/deflated", ai="yes",
       fail="broken | sagging | leak")
for cls in ["sway_bar_link", "control_arm", "suspension_bushing", "sway_bar_bushing", "strut_mount", "steering_rack_boot", "powertrain_mount"]:
    ck(cls, "condition", "Condition and security", "visual", "Tears, cracks, separation, play", "—", "visual", "n/a", "Intact, no play",
       "Surface cracking, minor tearing", "Separated/torn through, broken, or excessive movement", fail="torn | crack | excessive_play | broken")

# ---------------------------------------------------------------- driveline
ck("cv_boot", "integrity", "CV boot integrity", "visual", "Splits or cracks in the folds (turn the wheel to open them), loose or missing clamps, grease thrown nearby; check the full circumference", "—", "visual", "n/a", "Intact, no grease",
   "Cracked/aged but sealed", "Torn or split with grease loss", ai="yes", fail="torn | crack | leak")
ck("cv_axle", "joint", "CV joint", "functional", "Clicking on turns, play, vibration", "—", "pass_fail", "n/a", "Quiet, no play", "—",
   "Clicking/clunking or play", ai="no", fail="abnormal_noise | excessive_play")
for cls in ["universal_joint", "driveshaft_support_bearing", "driveshaft_flex_disc"]:
    ck(cls, "play", "Joint/bearing play", "functional", "Rotational/lateral play, rubber condition", "—", "pass_fail", "n/a", "No play",
       "Rubber cracking", "Play, torn rubber, noise/vibration", ai="no", fail="excessive_play | torn | abnormal_noise")
for cls in ["differential_fluid", "transfer_case_fluid", "manual_transmission_fluid"]:
    ck(cls, "level", "Fluid level at fill plug", "measurement", "Level relative to fill hole", "—", "categorical", "n/a", "At bottom of fill hole",
       "Slightly below fill hole", "Well below / no fluid, or metal debris", ai="no", fail="low_level | contaminated")
    ck(cls, "interval", "Service interval", "service_interval", "Miles since last service vs OEM interval", "miles", "numeric", "lower",
       "Not due", "Within 5,000 mi of interval", "Past interval", spec="OEM maintenance schedule", ai="no", fail="service_due")

# ---------------------------------------------------------------- engine & fluids
ck("engine_oil", "level", "Engine oil level", "measurement", "Dipstick (engine off, level ground) or electronic level", "—", "categorical", "n/a",
   "Between ADD and FULL", "At ADD mark (about 1 qt low), or slightly above FULL", "Below ADD / not on stick, or overfilled about 1 qt or more (foaming risk)", evidence="Dipstick photo",
   ai="partial", fail="low_level | overfilled")
ck("engine_oil", "condition", "Engine oil condition", "visual", "On the dipstick: black and gritty, milky (coolant), fuel smell, metal flakes or sludge", "—", "categorical", "n/a", "Normal",
   "Dark / due", "Milky (coolant), sludge, fuel smell, metal flakes", ai="partial", fail="degraded_fluid | contaminated")
ck("engine_oil", "oil_life", "Oil life / interval", "service_interval", "Oil-life monitor %, or miles since last change vs interval", "% remaining",
   "numeric", "higher", "> 25%", "6% – 25% (or within 500 mi of interval)", "≤ 5% or past interval", 25, 5, spec="Vehicle oil-life monitor / OEM schedule",
   evidence="Cluster photo", ai="yes", fail="service_due")
ck("engine_coolant", "freeze_point", "Coolant freeze protection", "test_equipment", "Refractometer or test strip", "°F", "numeric", "lower",
   "≤ -30°F", "-29°F to -15°F", "Warmer than -15°F, or warmer than the local winter low", -30, -15, spec="Tester",
   evidence="Reading photo", ai="no", fail="failed_test", basis="S8 (typical 50/50 mix protects to about -34°F)")
ck("thermostat", "regulation", "Thermostat regulation", "scan_tool", "Warm-up curve / coolant temperature PID; DTCs such as P0128", "°F", "categorical", "n/a",
   "Reaches normal operating temperature", "Slow warm-up or P0128 stored (poor heat, fuel economy)", "Overheating / stuck closed", spec="OEM operating temperature",
   evidence="Scan data / code screen", ai="no", fail="failed_test")
ck("engine_coolant", "level", "Coolant level", "visual", "Reservoir level with the engine cold; oil film, rust or debris in the coolant", "—", "categorical", "n/a", "At COLD/FULL",
   "Below COLD mark", "Empty reservoir or not visible", ai="yes", fail="low_level")
ck("engine_coolant", "condition", "Coolant condition", "visual", "Color, oil, rust, debris; test strip pH if used", "—", "categorical", "n/a",
   "Clean, correct color", "Discolored / old / strip out of range", "Oil or rust contamination, sludge", ai="partial", fail="degraded_fluid | contaminated | discolored")
ck("automatic_transmission_fluid", "level_condition", "ATF level and condition", "measurement", "Dipstick at operating temp per OEM; sealed units per OEM procedure", "—",
   "categorical", "n/a", "In range, red/pink, no odor", "Slightly low, or dark", "Well low, burnt odor, debris/metal", spec="OEM procedure",
   ai="partial", fail="low_level | degraded_fluid | contaminated")
ck("power_steering_fluid", "level_condition", "Power steering fluid", "visual", "Level on the reservoir or cap stick marks; dark, burnt or foamy fluid", "—", "categorical", "n/a", "In range",
   "Low or dark", "Empty, foamy, or pump whining", ai="yes", fail="low_level | degraded_fluid")
ck("windshield_washer_fluid", "level", "Washer fluid level", "visual", "Level in the reservoir or on the level stick; spray from both nozzles", "—", "categorical", "n/a", "Above low mark", "Low or empty (top off)",
   "—", ai="yes", fail="low_level")
ck("diesel_exhaust_fluid", "level", "DEF level", "measurement", "Gauge/cluster reading", "% full", "numeric", "higher", "> 25%", "10% – 25%",
   "< 10% (engine derate risk)", 25, 10, ai="yes", fail="low_level")
ck("diesel_exhaust_fluid", "quality", "DEF concentration", "test_equipment", "Refractometer", "% urea", "numeric", "in_range", "31.8% – 33.2%", "—",
   "Outside 31.8% – 33.2%", spec="ISO 22241 range", ai="no", fail="failed_test | contaminated", basis="S11")
ck("engine_assembly", "leaks", "Engine leak check", "visual", "Gaskets, seals, oil on underside", "—", "categorical", "n/a", "Dry",
   "Seepage / residue", "Active drip, or oil/coolant on exhaust", ai="yes", fail="seepage | leak | residue")
ck("engine_assembly", "running", "Running condition", "functional", "Idle quality, misfire, knocks, smoke", "—", "categorical", "n/a", "Smooth, quiet",
   "Minor noise/rough idle", "Knock, misfire, heavy smoke", ai="no", fail="abnormal_noise | failed_test")
ck("engine_air_filter", "condition", "Engine air filter", "visual", "Hold the filter face to light: dirt build-up, leaves or debris, oil soaking, damaged or collapsed pleats, rodent nesting", "—", "categorical", "n/a", "Clean", "Moderately dirty",
   "Heavily restricted, wet, damaged, or missing", ai="yes", fail="contaminated | debris_buildup | damaged")
ck("cabin_air_filter", "condition", "Cabin air filter", "visual", "Filter face: dirt and dust build-up, leaves or debris, musty smell or mold, damaged pleats", "—", "categorical", "n/a", "Clean", "Dirty, blocked, leaves/debris",
   "Missing or torn (unfiltered air)", ai="yes", fail="contaminated | debris_buildup | missing")
ck("accessory_drive_belt", "wear", "Belt wear (EPDM gauge) and condition", "measurement", "Groove wear gauge; ribs; tension indicator", "—",
   "pass_fail", "n/a", "Gauge pass, ribs intact", "Minor rib cracks, glazing, noise", "Gauge fail, chunks missing, fraying, cords showing",
   ai="yes", fail="failed_test | crack | frayed | glazed")
for cls in ["belt_tensioner", "idler_pulley", "water_pump"]:
    ck(cls, "noise_play", "Bearing noise and wobble", "functional", "Belt off or stethoscope; wobble/weep hole", "—", "categorical", "n/a",
       "Quiet, no wobble, dry", "Light noise, weep-hole residue", "Wobble, grinding, active leak", ai="no", fail="abnormal_noise | excessive_play | leak")
ck("timing_belt", "interval", "Timing belt interval", "service_interval", "Miles/years since replacement vs OEM interval", "miles", "numeric", "lower",
   "Not due", "Within 10,000 mi or 12 months of interval, or history unknown", "At or past interval", spec="OEM schedule", ai="no", fail="service_due")
ck("spark_plug", "interval", "Spark plug interval", "service_interval", "Miles since replacement vs OEM interval", "miles", "numeric", "lower",
   "Not due", "Within 10,000 mi of interval, or past interval with no misfire", "Misfire / worn out (engine no longer runs correctly)", spec="OEM schedule", ai="no", fail="service_due")
for cls in ["coolant_hose", "radiator", "coolant_reservoir"]:
    ck(cls, "pressure_test", "Cooling system pressure test", "test_equipment", "Pressurize to cap rating for 10+ minutes", "psi drop",
       "numeric", "lower", "Holds pressure, no leak", "Slight drop, no visible leak", "Cannot hold pressure or visible leak", spec="Cap rating",
       ai="no", fail="failed_test | leak")
ck("coolant_pressure_cap", "cap_test", "Pressure cap test", "test_equipment", "Cap tester at rated pressure", "psi", "pass_fail", "n/a", "Holds rated pressure",
   "—", "Fails to hold", spec="Cap rating", ai="no", fail="failed_test")
ck("radiator_cooling_fan", "operation", "Cooling fan operation", "functional", "Runs at temperature and with A/C on", "—", "pass_fail", "n/a",
   "Operates", "Noisy", "Inoperative", ai="no", fail="inoperative | abnormal_noise")

# ---------------------------------------------------------------- electrical
ck("low_voltage_battery", "tester", "Battery test (conductance/load)", "test_equipment", "Tester decision vs rated CCA", "result", "categorical", "n/a",
   "Good", "Good – recharge and retest", "Replace, or bad cell", spec="Tester output", evidence="Tester screen/printout photo", ai="partial",
   fail="failed_test | discharged")
ck("low_voltage_battery", "measured_cca", "Measured CCA vs rated CCA", "test_equipment", "Tester CCA result ÷ rated CCA on label", "% of rated",
   "numeric", "higher", "≥ 85%", "70% – 84%", "< 70%", 85, 70, spec="Battery label + tester", evidence="Tester result + battery label photo", ai="partial",
   fail="failed_test", basis="Wrynch default — needs shop confirmation (example: 601 of 800 CCA = 75% → Monitor)")
ck("low_voltage_battery", "open_circuit_voltage", "Open-circuit voltage (surface charge removed)", "measurement", "Voltmeter at terminals, engine off", "volts",
   "numeric", "higher", "≥ 12.4 V", "< 12.4 V (recharge and retest)", "— (low voltage alone is not a failure; use tester result)", 12.4, None, ai="no", fail="discharged",
   basis="S9 (12.6 V ≈ 100%, 12.4 V ≈ 75%, 12.2 V ≈ 50% state of charge)")
ck("low_voltage_battery", "cranking_voltage", "Cranking voltage", "measurement", "Minimum voltage while cranking at ~70°F", "volts", "numeric", "higher",
   "≥ 9.6 V", "—", "< 9.6 V", 9.6, 9.6, ai="no", fail="failed_test")
ck("battery_terminal", "condition", "Terminals and cables", "visual", "Corrosion, tightness", "—", "categorical", "n/a", "Clean and tight",
   "Corrosion present", "Loose, melted, or cable damaged", ai="yes", fail="corrosion | loose | melted")
ck("battery_hold_down", "security", "Battery hold-down", "functional", "Battery cannot move", "—", "pass_fail", "n/a", "Secure", "—", "Loose or missing",
   ai="yes", fail="loose | missing")
ck("alternator", "charging_voltage", "Charging voltage", "measurement", "Voltage at battery, engine running, loads off", "volts", "numeric", "in_range",
   "13.5 – 14.8 V (or OEM range for smart-charging systems)", "13.0 – 13.49 V", "< 13.0 V or > 15.0 V", None, None, spec="OEM spec where available",
   ai="no", fail="failed_test", basis="S10 (ranges vary on electronically controlled charging systems)")
ck("starter_motor", "crank", "Starter cranking", "functional", "Start test", "—", "categorical", "n/a", "Normal crank", "Slow crank (test battery first)",
   "No crank, grinding, or intermittent", ai="no", fail="inoperative | abnormal_noise | intermittent")
ck("horn", "operation", "Horn operation", "functional", "Press horn", "—", "pass_fail", "n/a", "Operates", "Weak tone", "Inoperative", ai="no", fail="inoperative")

LAMP_NAMES = ["headlamp", "tail_lamp", "turn_signal_lamp", "fog_lamp", "reverse_lamp", "high_mount_brake_lamp", "license_plate_lamp", "side_marker_lamp"]
for cls in LAMP_NAMES:
    ck(cls, "operation", "Lamp operation", "functional", "All functions (low/high, brake, signal, hazard as applicable)", "—", "pass_fail", "n/a",
       "All functions operate", "Dim or intermittent", "Any function inoperative", ai="partial", fail="inoperative | dim | intermittent")
    ck(cls, "lens", "Lens and housing", "visual", "Cracks, haze, moisture", "—", "visual", "n/a", "Clear, sealed", "Hazy/oxidized, condensation, small crack",
       "Lens broken or missing (white light shows / output blocked)", ai="yes", fail="cloudy | water_intrusion | crack | broken")
ck("headlamp", "aim", "Headlamp aim", "measurement", "Aim screen/wall check", "—", "pass_fail", "n/a", "Within pattern", "Slightly off", "Aimed into oncoming traffic or badly low",
   ai="no", fail="misaimed")
ck("interior_lamp", "operation", "Interior lamp operation", "functional", "Switch/door", "—", "pass_fail", "n/a", "Operates", "Inoperative", "—", ai="no", fail="inoperative")
ck("warning_indicator", "status", "Warning indicator status (by subtype)", "scan_tool", "Lamp state with engine running + stored codes", "subtype",
   "categorical", "n/a", "No indicators on after start", "check_engine (steady), tpms, maintenance_reminder, stability_control (off by switch)",
   "check_engine_flashing, brake, abs, airbag_srs, oil_pressure, coolant_temperature, charging, power_steering, ev_system", spec="Scan tool / owner's manual",
   evidence="Cluster photo + codes", ai="yes", fail="warning_indicator_on")
ck("instrument_cluster", "gauges", "Gauges and displays", "functional", "Gauges sweep/read, display legible", "—", "pass_fail", "n/a", "All working",
   "Segment/backlight out", "Speedometer or fuel/temp gauge inoperative", ai="partial", fail="inoperative | unreadable")

# ---------------------------------------------------------------- visibility & safety
ck("windshield", "damage", "Windshield damage", "measurement", "Size and location of chips/cracks", "inches", "categorical", "n/a", "No damage",
   "Chip < 1 in outside the driver's critical viewing area", "Any crack or chip in driver's critical viewing area, crack ≥ 6 in, chip ≥ 1 in, or crack reaching an edge",
   evidence="Photo with coin/ruler", ai="yes", fail="chip | crack | shattered", basis="S7")
ck("wiper_blade", "wipe", "Wipe quality", "functional", "Wet glass, run wipers", "—", "categorical", "n/a", "Clean sweep", "Streaks or chatter",
   "Torn/missing rubber, smears that block view", ai="partial", fail="streaking | torn | missing")
ck("wiper_motor", "operation", "Wiper operation", "functional", "All speeds and park", "—", "pass_fail", "n/a", "All speeds, parks correctly", "Slow or doesn't park",
   "Inoperative", ai="no", fail="inoperative")
ck("windshield_washer_pump", "operation", "Washer spray", "functional", "Spray pattern", "—", "pass_fail", "n/a", "Good spray on glass", "Weak/misdirected",
   "No spray", ai="no", fail="inoperative | obstructed")
ck("side_mirror_glass", "condition", "Mirror glass", "visual", "Cracked or missing glass, glass loose in the housing, power or manual adjustment that doesn't work", "—", "visual", "n/a", "Intact, adjusts", "Adjuster inoperative",
   "Cracked, broken, or missing", fail="crack | broken | missing")
ck("seat_belt", "function", "Seat belt function", "functional", "Latch, release, retract, lock on quick pull; webbing", "—", "pass_fail", "n/a",
   "All functions normal", "Slow retraction, light wear", "Won't latch/lock/retract, webbing cut or frayed", ai="partial", fail="inoperative | frayed | cut | torn")
ck("seat", "security", "Seat mounting and adjustment", "functional", "Rock seat; operate adjusters", "—", "pass_fail", "n/a", "Secure, adjusts",
   "Adjuster inoperative, upholstery worn/torn", "Seat loose or won't lock", ai="no", fail="loose | inoperative | torn")
ck("hood_latch", "secondary", "Hood latch and secondary catch", "functional", "Close hood; test secondary catch", "—", "pass_fail", "n/a", "Latches, secondary holds",
   "Stiff/needs lubrication", "Does not latch or secondary catch fails", ai="no", fail="inoperative | binding")
ck("backup_camera", "image", "Backup camera image", "functional", "Reverse selected", "—", "pass_fail", "n/a", "Clear image", "Blurry/dirty", "No image",
   ai="partial", fail="inoperative | obstructed")
for cls in ["adas_forward_camera", "adas_radar_sensor", "parking_sensor"]:
    ck(cls, "status", "Sensor status", "scan_tool", "Obstruction, damage, fault codes, calibration status", "—", "categorical", "n/a", "Clean, no faults",
       "Dirty/obstructed (clean and recheck)", "Damaged, fault present, or calibration required", ai="partial", fail="obstructed | damaged | failed_test")

# ---------------------------------------------------------------- exhaust, fuel, HVAC, EV
for cls in ["exhaust_pipe", "muffler", "catalytic_converter", "exhaust_manifold", "exhaust_flex_joint", "exhaust_resonator"]:
    ck(cls, "leak_integrity", "Exhaust leak and integrity", "visual", "Holes, rust-through, joints; listen/feel for leaks", "—", "categorical", "n/a",
       "Sealed, surface rust only", "Heavy scale rust, loose hanger/shield", "Any leak, hole, or disconnected section", ai="partial", fail="leak | rust | corrosion | punctured")
for cls in ["fuel_line", "fuel_tank", "fuel_hose", "fuel_filler_neck"]:
    ck(cls, "leak", "Fuel leak check", "visual", "Wet spots or drips, fuel odor, rust-through or heavy scale, chafing against the body", "—", "categorical", "n/a", "Dry, no odor", "Surface rust", "Any fuel leak or fuel odor",
       ai="partial", fail="leak | corrosion")
ck("cabin_air_vent", "ac_performance", "A/C vent temperature", "measurement", "Center vent, max A/C, recirculate, ambient 70–90°F", "°F", "numeric", "lower",
   "≤ 45°F", "Above 45°F, including not cooling (comfort item)", "— (use compressor check for failure risk)", 45, None, ai="no", fail="poor_performance")
ck("ac_compressor", "operation", "Compressor operation", "functional", "Clutch/compressor engages, no noise", "—", "pass_fail", "n/a", "Engages quietly",
   "Noisy, does not engage, or clutch overheating/smoking (comfort item — recommend soon)", "Seized so it stops or shreds the drive belt (belt may also run water pump/alternator)", ai="no", fail="inoperative | abnormal_noise | heat_damage")
ck("cabin_blower_motor", "operation", "Blower speeds", "functional", "All speeds", "—", "pass_fail", "n/a", "All speeds", "Some speeds missing, noise", "Inoperative",
   ai="no", fail="inoperative | abnormal_noise")
ck("high_voltage_battery_pack", "state_of_health", "HV battery state of health", "scan_tool", "Scan tool SOH / isolation test", "% SOH", "numeric", "higher",
   "≥ 80%", "70% – 79%", "< 70%, isolation fault, or HV DTC", 80, 70, spec="OEM scan data", ai="no", fail="failed_test",
   basis="Common EV battery warranty capacity threshold is ~70%; confirm per OEM")
ck("high_voltage_battery_pack", "enclosure", "HV battery enclosure", "visual", "Underbody impact, dents, leaks", "—", "visual", "n/a", "No damage",
   "Scrapes on shield only", "Dent/deformation of pack, leak, or heat damage", ai="yes", fail="dent | leak | damaged")
ck("high_voltage_cable", "integrity", "HV cable integrity", "visual", "Orange cable jacket and connectors (do not touch if damaged)", "—", "visual", "n/a",
   "Intact, secured", "Clip missing", "Any chafe, cut, exposed conductor, or connector damage", ai="yes", fail="chafed | exposed_conductor | connector_damage")
ck("charge_port_inlet", "pins", "Charge port pins and seal", "visual", "Pins, seal, debris, heat marks", "—", "visual", "n/a", "Clean, intact",
   "Debris (clean)", "Burned/melted or damaged pins", ai="yes", fail="burn_damage | melted | connector_damage")
ck("trailer_hitch_receiver", "integrity", "Hitch receiver", "visual", "Welds, cracks, mounting bolts", "—", "visual", "n/a", "Intact",
   "Surface rust", "Crack, bent, loose mounting", fail="crack | bent | loose")

# ---------------------------------------------------------------- visual check for every class without its own visual check
# Each says what to look for on that part (lookfor.py). Parts in REMOVE get none: nothing useful to see, or their other
# checks already cover it. Every part keeps at least one check.
have_visual = {x["cname"] for x in CHECKS if x["method"] == "visual"}
has_check = {x["cname"] for x in CHECKS}
for c in CLASSES:
    if c["name"] in have_visual:
        continue
    if c["name"] in REMOVE:
        assert c["name"] in has_check, f"{c['name']} would be left with no check"
        continue
    assert c["name"] in LOOK_FOR, f"No look-fors written for {c['name']}"
    fk = c["finding_keys"]
    ck(c["name"], "visual", "Visual condition", "visual", LOOK_FOR[c["name"]], "—", "visual", "n/a",
       "No applicable findings", "Findings whose default rating is monitor", "Any finding whose default rating is immediate attention",
       evidence="Photo", fail=" | ".join(fk[:6]) + (" …" if len(fk) > 6 else ""), basis="Rating comes from Class Findings")

unused = (set(LOOK_FOR) | REMOVE) - {c["name"] for c in CLASSES}
assert not unused, f"Look-fors for unknown parts: {unused}"
assert not (set(LOOK_FOR) & have_visual), f"Parts with their own visual check: {set(LOOK_FOR) & have_visual}"

# keep only failing findings that are valid for the class
for x in CHECKS:
    valid = set(BY_NAME[x["cname"]]["finding_keys"])
    toks = [t.strip() for t in x["fail"].replace("…", "").split("|") if t.strip()]
    kept = [t for t in toks if t in valid]
    x["fail"] = " | ".join(kept) + (" …" if "…" in x["fail"] else "")

for c in CLASSES:
    c["check_keys"] = [x["key"] for x in CHECKS if x["cname"] == c["name"]]

SOURCES = [
    ("S1", "Tire tread depth thresholds (2/32 legal minimum, 4/32 recommended, color bands)", "https://neotires.com/tire-tread-depth-chart-your-guide-to-safe-driving"),
    ("S2", "Tread depth conversion 32nds ↔ mm", "https://tengtoolsusa.com/blogs/news/tire-tread-depth-conversion-32-inch-mm"),
    ("S3", "FMVSS No. 138 TPMS (warning at 25% below placard)", "https://www.nhtsa.gov/sites/nhtsa.dot.gov/files/fmvss/tirepressure-fmvss-138.pdf"),
    ("S4", "Tire age guidance (6 / 10 years)", "https://www.edmunds.com/car-maintenance/how-old-and-dangerous-are-your-tires.html"),
    ("S5", "Brake fluid copper test — MAP requires replacement at 200 ppm", "https://phoenixsystems.co/pages/brake-fluid-testing-how-and-why-to-test"),
    ("S6", "49 CFR 570.7 steering lash and linkage free-play limits", "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-570/subpart-A/section-570.7"),
    ("S7", "Windshield repair vs replace sizes; no repair in driver's critical viewing area", "https://www.windshieldadvisor.org/safety-guides/windshield-damage-repair-vs-replace"),
    ("S8", "Antifreeze freeze protection (about -34°F)", "https://www.oreillyauto.com/how-to-hub/test-antifreeze-for-winter"),
    ("S9", "12 V lead-acid state-of-charge voltage chart", "https://www.batteryskills.com/12-volt-battery-voltage-chart/"),
    ("S10", "Alternator charging voltage varies by system; use OEM spec", "https://www.underhoodservice.com/alternator-testing-correct-voltage/"),
    ("S11", "ISO 22241 AUS 32 (DEF) urea concentration 31.8–33.2%", "https://www.iso.org/standard/72071.html"),
    ("S13", "49 CFR 570.9 tires (tread not less than 2/32 in; no bulges or exposed cords)", "https://www.law.cornell.edu/cfr/text/49/570.9"),
    ("S14", "49 CFR 570.5 service brakes (lining ≥ 1/32 in over rivets/shoe; rotor/drum within embossed limits; hoses not cracked/chafed/flattened)", "https://www.law.cornell.edu/cfr/text/49/570.5"),
    ("S12", "Motorist Assurance Program — inspection/service standards", "https://motorist.org/meeting-vehicle-inspection-standards-a-practical-guide/"),
]
