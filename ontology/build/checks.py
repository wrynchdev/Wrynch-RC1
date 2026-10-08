"""Condition checks per class: how each component is determined OK / Monitor / Immediate Attention (US units)."""
from findings import CLASSES, BY_NAME, FINDINGS
from lookfor import LOOK_FOR, REMOVE
from base import log

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
   "numeric", "lower", "< 2/32 difference", "≥ 2/32 difference (suggest alignment check)", "— (a groove at 2/32 is rated on tread depth; cords showing on structure)", 2, None,
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
ck("tire_valve_stem", "seal", "Valve stem condition", "visual", "Cracks, leaks (soap test), bent stem, missing cap", "—", "visual", "n/a", "Intact, cap present",
   "Cap missing; minor cracking", "Leaking, cracked through, bent", fail="crack | leak | missing | bent")
ck("tpms_sensor", "sensor_test", "TPMS sensor test", "test_equipment", "TPMS tool trigger: ID, pressure, battery status", "result",
   "pass_fail", "n/a", "Responds, battery OK", "Responds, low battery flagged", "No response or sensor fault", spec="Tester output", ai="no", evidence="Tool screen photo",
   fail="failed_test | inoperative")
ck("wheel", "condition", "Wheel condition", "visual", "Bends, cracks, curb damage, corrosion at the bead seat", "—", "visual", "n/a", "No damage", "Curb rash or other cosmetic damage, corrosion",
   "Crack, bent rim, or broken spoke", fail="bent | crack | broken")
ck("wheel_lug_nut", "security", "Lug nuts/bolts present and secure", "functional", "Count and torque check", "ft-lb",
   "pass_fail", "n/a", "All present, torqued to spec", "Corroded or damaged lock/nut still holding", "Any missing, loose, or damaged stud/thread",
   spec="Vehicle torque spec", fail="missing | loose | damaged | out_of_spec | corrosion", ai="yes")
ck("wheel_hub_bearing", "play_noise", "Hub/bearing play and noise", "functional", "12-and-6 rock test on lift; spin for noise; road test", "—",
   "categorical", "n/a", "No play, no noise", "Slight noise, no measurable play", "Measurable play beyond spec, grinding/roaring noise",
   spec="Vehicle spec", evidence="Video optional", ai="no", fail="excessive_play | abnormal_noise | binding | damaged")

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
ck("brake_rotor", "surface", "Rotor surface", "visual", "Scoring, heat spots, cracks, rust ridge, uneven wear", "—", "visual", "n/a", "Smooth, even contact",
   "Scoring or grooving (incl. major), rust ridge or surface rust, heat spots, uneven wear (pulsation)", "Crack, or grooves too deep to machine above minimum thickness", fail="scored | grooved | crack | heat_damage")
ck("brake_drum", "diameter", "Drum inside diameter vs maximum", "measurement", "Drum micrometer vs MAX DIA cast in drum", "mm",
   "numeric", "lower", "More than 0.8 mm below maximum", "Within 0.8 mm of maximum", "At or above maximum (discard) diameter",
   spec="Vehicle spec (cast MAX DIA)", ai="no", fail="out_of_spec")
ck("brake_caliper", "function_leak", "Leak and release check", "functional", "Wet seals; piston/slides free; wheel spins freely after release", "—",
   "pass_fail", "n/a", "Dry, releases freely", "Slides dry/sticky but releasing; boot cracked", "Fluid leak, seized piston or slides, dragging",
   fail="leak | binding | damaged_seal")
ck("brake_wheel_cylinder", "function_leak", "Leak and release check", "functional", "Peel back the boots: wet or crusty boots; pistons free; wheel spins freely after release", "—",
   "pass_fail", "n/a", "Dry, releases freely", "Damp or cracked boot, still releasing", "Fluid leak, seized piston, dragging",
   fail="leak | binding | damaged_seal")
ck("brake_hose", "integrity", "Hose integrity", "visual", "Leaks, swelling or bulges, cracking, chafing, kinks; flex the hose along its length", "—", "visual", "n/a", "Intact",
   "Minor surface weather cracking", "Any leak, swelling/bulge, cracked or chafed through the cover, collapsed", fail="leak | swollen | chafed | crack | torn | cut | collapsed")
ck("brake_line", "integrity", "Line integrity", "visual", "Leaks, heavy rust or scale, kinks, chafing; check the fittings", "—", "visual", "n/a", "Intact",
   "Surface rust", "Any leak, flaking or pitted rust, kinked or crushed line", fail="leak | rust | corrosion | chafed | deformation")
ck("brake_fluid", "copper", "Brake fluid copper content", "test_equipment", "Test strip (copper corrosion inhibitor depletion)", "ppm",
   "numeric", "lower", "< 100 ppm", "100 – 199 ppm", "≥ 200 ppm (fluid replacement required)", 100, 200, spec="Test strip",
   evidence="Strip next to color chart", ai="partial", fail="failed_test | degraded_fluid", basis="S5 (MAP: replacement required at 200 ppm copper)")
ck("brake_fluid", "moisture", "Brake fluid moisture (alternative test)", "test_equipment", "Electronic moisture/boiling-point tester", "% water",
   "numeric", "lower", "< 2%", "2% – 2.9%", "≥ 3%", 2, 3, spec="Tester", ai="no", fail="failed_test")
ck("brake_fluid", "level", "Brake fluid level", "visual", "Level vs MIN/MAX on the reservoir", "—", "categorical", "n/a", "Between MIN and MAX",
   "At MIN (check pad wear/leaks), or above MAX", "Below MIN", evidence="Photo of reservoir marks", ai="yes", fail="low_level | overfilled")
ck("brake_fluid", "condition", "Brake fluid condition", "visual", "Color and clarity in the reservoir: dark or cloudy fluid, debris or sludge", "—", "categorical", "n/a",
   "Clear, light amber", "Dark or cloudy (test copper or moisture)", "Contaminated: debris, sludge, or swollen seals (wrong fluid)", evidence="Photo of reservoir",
   ai="partial", fail="degraded_fluid | contaminated")
ck("brake_pedal", "feel", "Brake pedal feel and height", "functional", "Engine running: firm pedal, no sink under steady pressure", "—",
   "categorical", "n/a", "Firm and high", "Slightly soft or low but holds", "Spongy, sinks, or near floor", ai="no", fail="failed_test | excessive_play")
ck("brake_booster", "assist", "Booster assist test", "functional", "Pump pedal engine off, start engine: pedal should drop slightly", "—", "pass_fail", "n/a",
   "Assist present, no hiss", "—", "No assist, hissing, or hard pedal", ai="no", fail="failed_test | leak")
ck("parking_brake_control", "hold", "Parking brake hold", "functional", "Applies within spec travel and holds vehicle", "clicks / travel", "pass_fail", "n/a",
   "Holds within normal travel", "Holds but excess travel (adjustment)", "Does not hold, or electric brake fault", ai="no", fail="failed_test | excessive_play | inoperative | binding")

# ---------------------------------------------------------------- steering & suspension
ck("steering_wheel", "free_play", "Steering wheel free play (lash)", "measurement", "Rim movement before front wheels move, engine running", "inches at rim",
   "numeric", "lower", "≤ 1 in", "More than 1 in and under the limit", "≥ 2 in on a 16 in wheel (2.25 in @18, 2.5 in @20, 2.75 in @22)", 1, 2,
   ai="no", fail="excessive_play", basis="S6 (49 CFR 570.7 lash limits)")
for cls in ["outer_tie_rod_end", "inner_tie_rod", "idler_arm", "pitman_arm", "center_link", "drag_link"]:
    ck(cls, "play", "Linkage free play", "functional", "Push-pull / dry-park check", "inches", "numeric", "lower", "No perceptible play",
       "Slight play, under 1/4 in", "Linkage free play of 1/4 in or more", 0, 0.25, ai="no",
       fail="excessive_play", basis="S6 (49 CFR 570.7: linkage free play ≤ 1/4 in)")
ck("ball_joint", "play", "Ball joint play", "measurement", "Dial indicator with joint unloaded/loaded per OEM, or wear indicator", "inches",
   "numeric", "lower", "Within OEM spec / indicator protruding", "Within spec but near the limit", "Exceeds OEM spec, or wear indicator flush/recessed",
   spec="Vehicle spec", ai="no", fail="excessive_play")
for cls in ["shock_absorber", "strut_assembly"]:
    ck(cls, "leak", "Damper leak and condition", "visual", "Oil on the damper body (light misting is normal), torn dust boot, dents or bends in the body, broken or loose mounts", "—", "categorical", "n/a", "Dry or light misting (normal)",
       "Oil film or wet body, no drip; torn dust boot", "Oil running down the body or dripping; bent body; broken or loose mount", ai="yes", fail="leak | seepage | bent | broken | loose | damaged_seal")
    ck(cls, "damping", "Damping (bounce / road test)", "functional", "Bounce test and road test", "oscillations", "numeric", "lower",
       "Settles in ≤ 1 cycle", "1–2 cycles, or noticeable body float", "Continued bouncing; clunk from mount", 1, 2, ai="no",
       fail="failed_test | abnormal_noise")
ck("coil_spring", "integrity", "Spring integrity and ride height", "visual", "Broken or unseated coils, cracks, ride height vs spec", "—", "categorical", "n/a",
   "Intact, ride height within spec", "Sagging (ride height below spec), surface rust", "Broken, cracked or unseated coil", ai="yes",
   fail="broken | crack | sagging")
ck("leaf_spring", "integrity", "Spring integrity and ride height", "visual", "Broken, cracked or shifted leaves, loose U-bolts, worn shackles, ride height vs spec", "—", "categorical", "n/a",
   "Intact, ride height within spec", "Sagging, surface rust, worn shackle bushings", "Broken or cracked leaf, shifted leaves, loose U-bolts", ai="yes",
   fail="broken | crack | sagging | loose | misaligned")
ck("air_spring", "integrity", "Air spring integrity and ride height", "visual", "Cracks or dry rot in the bag, chafing, leaks (soap test), ride height vs spec", "—", "categorical", "n/a",
   "Intact, holds height", "Dry rot or surface cracking, slow leak-down", "Leaking or deflated, torn or cracked through", ai="yes",
   fail="leak | crack | torn | dry_rot | chafed | sagging | broken")
ck("control_arm", "condition", "Arm condition and security", "visual", "Bends, cracks, rust-through, loose mounting bolts; play at the bushings and joint", "—", "visual", "n/a",
   "Straight, intact, secure", "Surface rust, light corrosion", "Cracked, bent, broken, rust-through, loose, or excessive play", fail="crack | bent | broken | loose | excessive_play")
ck("sway_bar_link", "condition", "Link condition and play", "visual", "Grip and twist the link: joint play, torn boots, bent or broken link, clunk over bumps", "—", "visual", "n/a",
   "No play, boots intact", "Torn boot, slight play", "Excessive play, broken or bent link, separated joint", fail="excessive_play | damaged_seal | bent | broken")
for cls in ["suspension_bushing", "sway_bar_bushing"]:
    ck(cls, "condition", "Bushing condition", "visual", "Cracks or tears in the rubber, rubber pushed out or separated, play at the bolt", "—", "visual", "n/a",
       "Intact, no play", "Surface cracking or dry rot, minor tearing", "Torn through or separated, broken, missing, or excessive movement", fail="torn | crack | dry_rot | excessive_play | broken")
ck("strut_mount", "condition", "Mount condition", "visual", "Cracked or separated rubber, clunk or binding when steering (bearing), loose top nuts", "—", "visual", "n/a",
   "Intact, turns smoothly", "Surface cracking, light noise when steering", "Separated or torn through, binding bearing, loose, or excessive movement", fail="torn | crack | binding | abnormal_noise | excessive_play | loose")
ck("powertrain_mount", "condition", "Mount condition", "visual", "Cracked, separated or collapsed rubber, fluid from a hydraulic mount, engine lift under load (brake torque)", "—", "visual", "n/a",
   "Intact, little movement under load", "Surface cracking, seeping hydraulic mount", "Separated or broken mount, collapsed rubber, or excessive movement", fail="torn | crack | collapsed | leak | excessive_play | broken")
ck("steering_rack_boot", "condition", "Boot condition", "visual", "Splits or cracks in the folds, loose or missing clamps, fluid inside the boot", "—", "visual", "n/a",
   "Intact, clamps tight, dry", "Cracked or aged, still sealed", "Torn or split, missing, or fluid in the boot (rack leaking)", fail="torn | crack | missing | leak")

# ---------------------------------------------------------------- driveline
ck("cv_boot", "integrity", "CV boot integrity", "visual", "Splits or cracks in the folds (turn the wheel to open them), loose or missing clamps, grease thrown nearby; check the full circumference", "—", "visual", "n/a", "Intact, no grease",
   "Cracked/aged but sealed", "Torn or split with grease loss", ai="yes", fail="torn | crack | leak | dry_rot | aged | missing")
ck("cv_axle", "joint", "CV joint", "functional", "Clicking on turns, play, vibration", "—", "pass_fail", "n/a", "Quiet, no play", "—",
   "Clicking/clunking or play", ai="no", fail="abnormal_noise | excessive_play")
ck("universal_joint", "play", "Joint play", "functional", "Twist and push the shaft by hand at the joint; rust dust at the caps means a dry joint", "—", "pass_fail", "n/a", "No play, turns smoothly",
   "Dry joint (rust dust at the caps), no play", "Play, binding, clunk or vibration", ai="no", fail="excessive_play | binding | abnormal_noise")
for cls in ["driveshaft_support_bearing", "driveshaft_flex_disc"]:
    ck(cls, "play", "Joint/bearing play", "functional", "Rotational/lateral play, rubber condition", "—", "pass_fail", "n/a", "No play",
       "Rubber cracking", "Play, torn rubber, noise/vibration", ai="no", fail="excessive_play | torn | abnormal_noise")
for cls in ["differential_fluid", "transfer_case_fluid", "manual_transmission_fluid"]:
    ck(cls, "level", "Fluid level and condition at fill plug", "measurement", "Level relative to the fill hole; fluid on a finger: burnt smell, metal or milky", "—", "categorical", "n/a", "At bottom of fill hole",
       "Slightly below fill hole, or dark", "Well below / no fluid, metal debris, or water in the fluid", ai="no", fail="low_level | overfilled | contaminated | degraded_fluid")
    ck(cls, "interval", "Service interval", "service_interval", "Miles or time since last service vs OEM interval", "—", "categorical", "n/a",
       "Not due", "Within 5,000 mi of interval, past interval, or history unknown", "— (a fluid past its interval still works; rate its level and condition)", spec="OEM maintenance schedule", ai="no", fail="service_due")

# ---------------------------------------------------------------- engine & fluids
ck("engine_oil", "level", "Engine oil level", "measurement", "Dipstick (engine off, level ground) or electronic level", "—", "categorical", "n/a",
   "Between ADD and FULL", "At ADD mark (about 1 qt low), or slightly above FULL", "Below ADD / not on stick, or overfilled about 1 qt or more (foaming risk)", evidence="Dipstick photo",
   ai="partial", fail="low_level | overfilled")
ck("engine_oil", "condition", "Engine oil condition", "visual", "On the dipstick: black and gritty, milky (coolant), fuel smell, metal flakes or sludge", "—", "categorical", "n/a", "Normal",
   "Dark (due for a change)", "Milky (coolant), sludge, fuel smell, metal flakes", ai="partial", fail="degraded_fluid | contaminated")
ck("engine_oil", "oil_life", "Oil life / interval", "service_interval", "Oil-life monitor %, or miles since last change vs interval", "% remaining",
   "numeric", "higher", "> 25%", "6% – 25% (or within 500 mi of interval)", "≤ 5% or past interval", 25, 5, spec="Vehicle oil-life monitor / OEM schedule",
   evidence="Cluster photo", ai="yes", fail="service_due")
ck("engine_coolant", "freeze_point", "Coolant freeze protection", "test_equipment", "Refractometer or test strip", "°F", "numeric", "lower",
   "≤ -30°F", "-29°F to -15°F", "Warmer than -15°F, or warmer than the local winter low", -30, -15, spec="Tester",
   evidence="Reading photo", ai="no", fail="failed_test", basis="S8 (typical 50/50 mix protects to about -34°F)")
ck("thermostat", "regulation", "Thermostat regulation", "scan_tool", "Warm-up curve / coolant temperature PID; DTCs such as P0128", "—", "categorical", "n/a",
   "Reaches normal operating temperature", "Slow warm-up or P0128 stored (poor heat, fuel economy)", "Overheating / stuck closed", spec="OEM operating temperature",
   evidence="Scan data / code screen", ai="no", fail="failed_test | binding")
ck("engine_coolant", "level", "Coolant level", "visual", "Reservoir level with the engine cold", "—", "categorical", "n/a", "At COLD/FULL",
   "Below the COLD mark, or well above FULL", "Empty reservoir or not visible", ai="yes", fail="low_level | overfilled")
ck("engine_coolant", "condition", "Coolant condition", "visual", "Color, oil, rust, debris; test strip pH if used", "—", "categorical", "n/a",
   "Clean, correct color", "Discolored, old, or strip out of range", "Oil or rust contamination, sludge", ai="partial", fail="degraded_fluid | contaminated")
ck("automatic_transmission_fluid", "level_condition", "ATF level and condition", "measurement", "Dipstick at operating temp per OEM; sealed units per OEM procedure", "—",
   "categorical", "n/a", "In range, red/pink, no odor", "Slightly low, or dark", "Well low, burnt odor, debris/metal", spec="OEM procedure",
   ai="partial", fail="low_level | overfilled | degraded_fluid | contaminated")
ck("power_steering_fluid", "level_condition", "Power steering fluid", "visual", "Level on the reservoir or cap stick marks; dark, burnt or foamy fluid", "—", "categorical", "n/a", "In range",
   "Low or dark", "Empty, foamy, or contaminated (rate a whining pump on the pump)", ai="yes", fail="low_level | overfilled | degraded_fluid | contaminated")
ck("windshield_washer_fluid", "level", "Washer fluid level", "visual", "Level in the reservoir or on the level stick", "—", "categorical", "n/a", "Above low mark", "Low or empty (top off)",
   "—", ai="yes", fail="low_level")
ck("diesel_exhaust_fluid", "level", "DEF level", "measurement", "Gauge/cluster reading", "% full", "numeric", "higher", "> 25%", "10% – 25%",
   "< 10% (engine derate risk)", 25, 10, ai="yes", fail="low_level")
ck("diesel_exhaust_fluid", "quality", "DEF concentration", "test_equipment", "Refractometer", "% urea", "numeric", "in_range", "31.8% – 33.2%", "—",
   "Outside 31.8% – 33.2%, or crystals/contamination", spec="ISO 22241 range", ai="no", fail="failed_test | contaminated | degraded_fluid", basis="S11")
ck("engine_assembly", "leaks", "Engine leak check", "visual", "Gaskets, seals, oil on underside", "—", "categorical", "n/a", "Dry",
   "Seepage / residue", "Active drip, or oil/coolant on exhaust", ai="yes", fail="seepage | leak | residue | crack | heat_damage")
ck("engine_assembly", "running", "Running condition", "functional", "Idle quality, misfire, knocks, smoke", "—", "categorical", "n/a", "Smooth, quiet",
   "Minor noise/rough idle", "Knock, misfire, heavy smoke, or won't start", ai="no", fail="abnormal_noise | failed_test | inoperative")
ck("engine_air_filter", "condition", "Engine air filter", "visual", "Hold the filter face to light: dirt build-up, leaves or debris, oil soaking, damaged or collapsed pleats, rodent nesting", "—", "categorical", "n/a", "Clean", "Moderately dirty",
   "Heavily restricted, wet, damaged, or missing", ai="yes", fail="contaminated | debris_buildup | obstructed | damaged | water_intrusion | missing")
ck("cabin_air_filter", "condition", "Cabin air filter", "visual", "Filter face: dirt and dust build-up, leaves or debris, musty smell or mold, damaged pleats", "—", "categorical", "n/a", "Clean", "Dirty, blocked, leaves/debris",
   "Missing or torn (unfiltered air)", ai="yes", fail="contaminated | debris_buildup | obstructed | water_intrusion | damaged | missing")
ck("accessory_drive_belt", "wear", "Belt wear (EPDM gauge) and condition", "measurement", "Groove wear gauge; ribs; tension indicator", "—",
   "pass_fail", "n/a", "Gauge pass, ribs intact", "Minor rib cracks, glazing, noise", "Gauge fail, chunks missing, fraying, cords showing",
   ai="yes", fail="failed_test | crack | frayed | glazed")
ck("water_pump", "noise_play", "Bearing noise and wobble", "functional", "Belt off or stethoscope; pulley wobble; weep hole", "—", "categorical", "n/a",
   "Quiet, no wobble, dry", "Light noise, weep-hole residue", "Wobble, grinding, active leak", ai="no", fail="abnormal_noise | excessive_play | leak")
ck("belt_tensioner", "noise_play", "Tensioner bearing and arm", "functional", "Engine idling: watch the arm against its marks; belt off: spin the pulley and listen", "—", "categorical", "n/a",
   "Quiet, arm steady within its marks", "Light bearing noise, or arm near the end of its marks", "Pulley wobble, grinding, arm bouncing or outside its marks", ai="no",
   fail="abnormal_noise | excessive_play | worn | binding | misaligned")
ck("idler_pulley", "noise_play", "Pulley bearing noise and wobble", "functional", "Belt off: spin the pulley by hand and rock it; or stethoscope with the engine running", "—", "categorical", "n/a",
   "Quiet, turns freely, no wobble", "Light bearing noise", "Wobble, grinding, rough or seized bearing, cracked pulley", ai="no",
   fail="abnormal_noise | excessive_play | binding | crack")
ck("timing_belt", "interval", "Timing belt interval", "service_interval", "Miles/years since replacement vs OEM interval", "—", "categorical", "n/a",
   "Not due", "Within 10,000 mi or 12 months of interval, or history unknown", "At or past the OEM replacement interval (a failed belt can destroy the engine)", spec="OEM schedule", ai="no", fail="service_due")
ck("spark_plug", "interval", "Spark plug interval", "service_interval", "Miles since replacement vs OEM interval", "—", "categorical", "n/a",
   "Not due", "Within 10,000 mi of interval, or past interval", "— (a misfire is rated on engine running condition and plug condition)", spec="OEM schedule", ai="no", fail="service_due")
ck("radiator", "pressure_test", "Cooling system pressure test", "test_equipment", "Pressurize the system to the cap rating for 10+ minutes; look for leaks at hoses, reservoir and radiator", "psi drop",
   "numeric", "lower", "Holds pressure, no leak", "Slight drop, no visible leak", "Cannot hold pressure or visible leak (rate the leaking part too)", spec="Cap rating",
   ai="no", fail="failed_test | leak")
ck("hood_release_cable", "release", "Hood release", "functional", "Pull the release: the hood pops up to the safety catch", "—", "pass_fail", "n/a",
   "Releases with one pull", "Stiff, or needs more than one pull", "Won't release the hood", ai="no", fail="inoperative | binding | broken")
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
   "Corrosion present", "Loose, melted or burned, or terminal damaged", ai="yes", fail="corrosion | loose | melted | burn_damage | damaged")
ck("battery_hold_down", "security", "Battery hold-down", "functional", "Battery cannot move", "—", "pass_fail", "n/a", "Secure", "—", "Loose or missing",
   ai="yes", fail="loose | missing")
ck("alternator", "charging_voltage", "Charging voltage", "measurement", "Voltage at battery, engine running, loads off", "volts", "numeric", "in_range",
   "13.5 – 14.8 V (or OEM range for smart-charging systems)", "13.0 – 13.49 V, or 14.81 – 15.0 V", "< 13.0 V or > 15.0 V", None, None, spec="OEM spec where available",
   ai="no", fail="failed_test", basis="S10 (ranges vary on electronically controlled charging systems)")
ck("starter_motor", "crank", "Starter cranking", "functional", "Start test", "—", "categorical", "n/a", "Normal crank", "Slow crank (test battery first)",
   "No crank, grinding, or intermittent", ai="no", fail="inoperative | abnormal_noise | intermittent | poor_performance")
ck("horn", "operation", "Horn operation", "functional", "Press horn", "—", "pass_fail", "n/a", "Operates", "Weak tone", "Inoperative", ai="no", fail="inoperative")

LAMP_NAMES = ["headlamp", "tail_lamp", "turn_signal_lamp", "fog_lamp", "reverse_lamp", "high_mount_brake_lamp", "license_plate_lamp", "side_marker_lamp"]
LAMP_HOW = {
    "headlamp": "Low and high beam (and DRL if equipped)", "tail_lamp": "Tail, brake and any built-in signal",
    "turn_signal_lamp": "Left and right signal, and hazards", "fog_lamp": "Fog lamp switch on",
    "reverse_lamp": "Reverse selected, ignition on", "high_mount_brake_lamp": "Brake pedal applied",
    "license_plate_lamp": "Parking lamps on", "side_marker_lamp": "Parking lamps on",
}
for cls in LAMP_NAMES:
    ck(cls, "operation", "Lamp operation", "functional", LAMP_HOW[cls], "—", "pass_fail", "n/a",
       "All functions operate", "Dim or intermittent", "Any function inoperative", ai="partial", fail="inoperative | dim | intermittent")
    ck(cls, "lens", "Lens and housing", "visual", "Cracks, haze, moisture inside, loose or missing lens or housing", "—", "visual", "n/a", "Clear, sealed", "Hazy/oxidized, condensation, small crack",
       "Lens broken or missing (white light shows / output blocked)", ai="yes", fail="cloudy | water_intrusion | crack | broken | missing")
ck("headlamp", "aim", "Headlamp aim", "measurement", "Aim screen/wall check", "—", "pass_fail", "n/a", "Within pattern", "Slightly off", "Aimed into oncoming traffic or badly low",
   ai="no", fail="misaimed")
ck("interior_lamp", "operation", "Interior lamp operation", "functional", "Switch/door", "—", "pass_fail", "n/a", "Operates", "Inoperative", "—", ai="no", fail="inoperative")
ck("warning_indicator", "status", "Warning indicator status (by subtype)", "scan_tool", "Lamp state with engine running + stored codes; key-on bulb check", "—",
   "categorical", "n/a", "No indicators on after start", "check_engine (steady), tpms, maintenance_reminder, stability_control (off by switch)",
   "check_engine_flashing, brake, abs, airbag_srs, oil_pressure, coolant_temperature, charging, power_steering, ev_system; or a lamp that doesn't light at the key-on bulb check", spec="Scan tool / owner's manual",
   evidence="Cluster photo + codes", ai="yes", fail="warning_indicator_on | inoperative")
ck("instrument_cluster", "gauges", "Gauges and displays", "functional", "Gauges sweep/read, display legible", "—", "pass_fail", "n/a", "All working",
   "Segment/backlight out", "Speedometer or fuel/temp gauge inoperative", ai="partial", fail="inoperative | unreadable")

# ---------------------------------------------------------------- visibility & safety
ck("windshield", "damage", "Windshield damage", "measurement", "Size and location of chips/cracks", "—", "categorical", "n/a", "No damage",
   "Chip < 1 in outside the driver's critical viewing area", "Any crack or chip in driver's critical viewing area, crack ≥ 6 in, chip ≥ 1 in, or crack reaching an edge",
   evidence="Photo with coin/ruler", ai="yes", fail="chip | crack | shattered", basis="S7")
ck("wiper_blade", "wipe", "Wipe quality", "functional", "Wet glass, run wipers", "—", "categorical", "n/a", "Clean sweep", "Streaks or chatter",
   "Torn/missing rubber, smears that block view", ai="partial", fail="streaking | torn | missing")
ck("wiper_motor", "operation", "Wiper operation", "functional", "All speeds and park", "—", "pass_fail", "n/a", "All speeds, parks correctly", "Slow, noisy, missing a speed, or doesn't park",
   "Inoperative or binds", ai="no", fail="inoperative | intermittent | binding | abnormal_noise | poor_performance")
ck("windshield_washer_pump", "operation", "Washer spray", "functional", "Spray pattern", "—", "pass_fail", "n/a", "Good spray on glass", "Weak/misdirected",
   "No spray", ai="no", fail="inoperative | obstructed")
ck("side_mirror_glass", "condition", "Mirror glass", "visual", "Cracked or missing glass, glass loose in the housing, power or manual adjustment that doesn't work", "—", "visual", "n/a", "Intact, adjusts", "Adjuster inoperative, desilvering at the edges",
   "Cracked, broken, or missing", fail="crack | broken | missing | inoperative")
ck("seat_belt", "function", "Seat belt function", "functional", "Latch, release, retract, lock on quick pull; webbing", "—", "pass_fail", "n/a",
   "All functions normal", "Slow retraction, light wear", "Won't latch/lock/retract, webbing cut or frayed", ai="partial", fail="inoperative | frayed | cut | torn | binding | worn")
ck("seat", "security", "Seat mounting and adjustment", "functional", "Rock seat; operate adjusters", "—", "pass_fail", "n/a", "Secure, adjusts",
   "Adjuster inoperative, upholstery worn/torn", "Seat loose or won't lock", ai="no", fail="loose | inoperative | torn")
ck("hood_latch", "secondary", "Hood latch and secondary catch", "functional", "Close hood; test secondary catch", "—", "pass_fail", "n/a", "Latches, secondary holds",
   "Stiff/needs lubrication", "Does not latch or secondary catch fails", ai="no", fail="inoperative | binding")
ck("backup_camera", "image", "Backup camera image", "functional", "Reverse selected", "—", "pass_fail", "n/a", "Clear image", "Blurry/dirty", "No image",
   ai="partial", fail="inoperative | obstructed")
for cls in ["adas_forward_camera", "adas_radar_sensor", "parking_sensor"]:
    ck(cls, "status", "Sensor status", "scan_tool", "Obstruction, damage, fault codes, calibration status", "—", "categorical", "n/a", "Clean, no faults",
       "Dirty/obstructed (clean and recheck)", "Damaged, fault present, or calibration required", ai="partial", fail="obstructed | damaged | failed_test | misaligned")

# ---------------------------------------------------------------- exhaust, fuel, HVAC, EV
for cls in ["exhaust_pipe", "muffler", "catalytic_converter", "exhaust_manifold", "exhaust_flex_joint", "exhaust_resonator"]:
    ck(cls, "leak_integrity", "Exhaust leak and integrity", "visual", "Holes, cracks, rust-through, joints and flanges; listen/feel for leaks", "—", "categorical", "n/a",
       "Sealed, surface rust only", "Heavy scale rust, loose joint, heat damage", "Any leak, hole, crack through, or disconnected section", ai="partial", fail="leak | rust | corrosion | punctured | crack | disconnected")
FUEL_TEXT = {
    "fuel_hose": ("Wet spots or drips, fuel odor; cracks, swelling, hardening or chafing in the rubber; loose clamps",
                  "Surface cracking, hardened or chafed cover, no leak", "Any fuel leak or fuel odor; cracked or chafed through", "leak | crack | dry_rot | swollen | chafed"),
    "fuel_line": ("Wet spots or drips, fuel odor; rust or scale on steel lines, kinks, chafing against the body",
                  "Surface rust, light chafing", "Any fuel leak or fuel odor; rust-through, kinked or crushed line", "leak | corrosion | rust | chafed | deformation"),
    "fuel_tank": ("Wet spots or drips, fuel odor; rust, dents or punctures in the tank; loose or broken straps",
                  "Surface rust on tank or straps, minor dents", "Any fuel leak or fuel odor; rust-through or punctured tank; loose or broken strap", "leak | corrosion | rust | punctured | loose | broken"),
    "fuel_filler_neck": ("Wet spots or fuel odor at the neck and its hose joints, rust, loose mounting",
                         "Surface rust", "Any fuel leak or fuel odor; rust-through or cracked neck", "leak | corrosion | rust | crack | loose"),
}
for cls, (how, mon, imm, fail) in FUEL_TEXT.items():
    ck(cls, "leak", "Fuel leaks and condition", "visual", how, "—", "categorical", "n/a", "Dry, no odor, sound", mon, imm, ai="partial", fail=fail)
ck("cabin_air_vent", "ac_performance", "A/C vent temperature", "measurement", "Measure at the center vent only: max A/C, recirculate, ambient 70–90°F (rate other vents on their visual condition)", "°F", "numeric", "lower",
   "≤ 45°F", "Above 45°F, including not cooling (comfort item)", "— (use compressor check for failure risk)", 45, None, ai="no", fail="poor_performance")
ck("ac_compressor", "operation", "Compressor operation", "functional", "Clutch/compressor engages, no noise", "—", "pass_fail", "n/a", "Engages quietly",
   "Noisy, does not engage, or clutch overheating/smoking (comfort item — recommend soon)", "Seized so it stops or shreds the drive belt (belt may also run water pump/alternator)", ai="no", fail="inoperative | abnormal_noise | heat_damage | binding")
ck("cabin_blower_motor", "operation", "Blower speeds", "functional", "All speeds", "—", "pass_fail", "n/a", "All speeds", "Some speeds missing, weak airflow, or noise", "Inoperative",
   ai="no", fail="inoperative | intermittent | abnormal_noise | binding | poor_performance")
ck("high_voltage_battery_pack", "state_of_health", "HV battery state of health", "scan_tool", "Scan tool SOH / isolation test", "% SOH", "numeric", "higher",
   "≥ 80%", "70% – 79%", "< 70%, isolation fault, or HV DTC", 80, 70, spec="OEM scan data", ai="no", fail="failed_test",
   basis="Common EV battery warranty capacity threshold is ~70%; confirm per OEM")
ck("high_voltage_battery_pack", "enclosure", "HV battery enclosure", "visual", "Underbody impact, dents, leaks", "—", "visual", "n/a", "No damage",
   "Scrapes or abrasion on the shield only", "Dent/deformation of pack, leak, or heat damage", ai="yes", fail="dent | deformation | leak | heat_damage | damaged | abrasion")
ck("high_voltage_cable", "integrity", "HV cable integrity", "visual", "Orange cable jacket and connectors (do not touch if damaged)", "—", "visual", "n/a",
   "Intact, secured", "Clip missing or cable loose", "Any chafe, cut, exposed conductor, or connector damage", ai="yes", fail="chafed | cut | exposed_conductor | connector_damage | missing | loose")
ck("charge_port_inlet", "pins", "Charge port pins and seal", "visual", "Pins, seal, debris, heat marks", "—", "visual", "n/a", "Clean, intact",
   "Debris or corrosion (clean), worn seal", "Burned/melted or damaged pins", ai="yes", fail="burn_damage | melted | connector_damage | debris_buildup | corrosion | damaged_seal")
ck("trailer_hitch_receiver", "integrity", "Hitch receiver", "visual", "Welds, cracks, mounting bolts", "—", "visual", "n/a", "Intact",
   "Surface rust", "Crack, bent, broken weld, loose mounting", fail="crack | bent | broken | loose | rust")

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

for c in CLASSES:
    c["check_keys"] = [x["key"] for x in CHECKS if x["cname"] == c["name"]]

# ---------------------------------------------------------------- findings each check offers (1.4.0)
# A finding is recorded under the check it explains, so every check lists the findings it can offer, and every finding
# a part can have is offered by at least one of its checks.
#  * A measured, tested or functional check offers the findings written for it above.
#  * Each part has at most one general condition check: its "Visual condition" check, else its only visual-type check,
#    else one named in GENERAL. It offers its own findings plus every other finding of the part, except findings
#    another look-or-measure check owns (tread depth owns low_tread, chip sizing owns chip/crack) and findings
#    nobody can see that a test or functional check owns (inoperative, failed_test, service_due …).
# A confirmed AI finding is filed under the first check (in this order) that offers it.
GENERAL = {
    **{n: "leak" for n in ["fuel_hose", "fuel_line", "fuel_tank", "fuel_filler_neck", "shock_absorber", "strut_assembly"]},
    **{n: "leak_integrity" for n in ["exhaust_pipe", "muffler", "catalytic_converter", "exhaust_manifold", "exhaust_flex_joint", "exhaust_resonator"]},
    **{n: "integrity" for n in ["coil_spring", "leaf_spring", "air_spring"]},
    "engine_oil": "condition", "engine_coolant": "condition", "brake_fluid": "condition", "engine_assembly": "leaks",
    "automatic_transmission_fluid": "level_condition", "power_steering_fluid": "level_condition",
    "battery_terminal": "condition", "engine_air_filter": "condition", "cabin_air_filter": "condition",
}
NOT_VISIBLE = {"inoperative", "intermittent", "dim", "failed_test", "service_due", "poor_performance", "low_pressure",
               "over_pressure", "discharged", "excessive_play", "abnormal_noise", "binding", "out_of_spec", "low_level",
               "overfilled", "streaking", "misaimed", "low_tread", "uneven_wear", "aged", "warning_indicator_on"}
LOOKS = {"visual", "measurement"}  # methods of checks that look at the part itself


def split(fail):
    return [t.strip() for t in fail.replace("…", "").split("|") if t.strip()]


BY_KEY = {x["key"]: x for x in CHECKS}
PROBLEMS = []
for c in CLASSES:
    keys = c["finding_keys"]
    own = [BY_KEY[k] for k in c["check_keys"]]
    for x in own:
        bad = [t for t in split(x["fail"]) if t not in keys]
        if bad:
            PROBLEMS.append(f"{x['key']} offers findings {c['name']} can't have: {bad}")
    general = None
    if f"{c['name']}.visual" in BY_KEY:
        general = BY_KEY[f"{c['name']}.visual"]
    elif c["name"] in GENERAL:
        general = BY_KEY[f"{c['name']}.{GENERAL[c['name']]}"]
    else:
        vis = [x for x in own if x["vtype"] == "visual"]
        general = vis[0] if len(vis) == 1 else None
    c["general_check"] = general["key"] if general else None
    if general:
        owned = set()
        for x in own:
            if x is general:
                continue
            for t in split(x["fail"]):
                if x["method"] in LOOKS or t in NOT_VISIBLE:
                    owned.add(t)
        mine = split(general["fail"]) if general["key"] != f"{c['name']}.visual" else []
        offer = [t for t in keys if t in mine or t not in owned]
        general["fail"] = " | ".join(offer)
    offered = {t for x in own for t in split(x["fail"])}
    missing = [t for t in keys if t not in offered]
    if missing:
        PROBLEMS.append(f"{c['name']}: no check offers {missing}")
assert not PROBLEMS, "\n".join(PROBLEMS)

log("Condition Checks", "Findings when not OK", "Measured checks named a few findings; visual checks showed the first six of the part's findings; many findings were offered by no check",
    "Every check lists the findings it offers. A part's general condition check offers every finding no other look-or-measure check owns, and every finding a part can have is offered by at least one check",
    "Findings are recorded under the check they explain (findings were first written per component).", "Yes", "1.4.0")
log("Condition Checks", "Check wording", "Several checks shared text written for another part (coil/leaf/air springs, brake hose/line, control arm vs bushings, U-joint vs flex disc, idler pulley/tensioner vs water pump, every lamp)",
    "Each part has its own wording, and every band names a condition the check can record a finding for", "Techs and the AI read the check text for the part in front of them.", "Yes", "1.4.0")
log("Condition Checks", "coolant_hose.pressure_test, coolant_reservoir.pressure_test", "Same system test on three parts", "On the radiator only",
    "One pressure test gave three results. Rate the leaking part on its own check.", "Yes", "1.4.0")
log("Condition Checks", "Interval checks (timing belt, spark plugs, gear oils)", "numeric miles with word bands", "categorical: not due / due soon / past due",
    "The typed miles were never rated. Gear oil and spark plugs past interval are Monitor (still working); a timing belt past its OEM interval stays Immediate.", "Yes", "1.4.0")
log("Condition Checks", "New checks", "—", "brake_fluid.condition, hood_release_cable.release", "Fluid condition was written into the level check; the hood release had nothing to rate its function.", "No", "1.4.0")
log("Class Findings", "Per-part finding lists", "Findings came from shared category groups", "Parts list the findings they can actually have",
    "Removed findings from other kinds of part (belt findings on a timing cover, bearing findings on a reservoir, electrical findings on a tow hook, paint findings on a soft top).", "Yes", "1.4.0")

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
