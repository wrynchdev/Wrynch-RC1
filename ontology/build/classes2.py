"""New classes (IDs 238+), safety-critical flag, AI photo assessability, capture guidance."""
from base import CLASSES, BY_NAME, FLAG_COLS, CORNERS, SEATS, log

# name, display, category, rule_code, allowed_positions, implied, rule_text, note, subtype_examples, material_allowed
NEW = [
    ("engine_oil", "engine oil", "fluids", "none", "", None, "Separate metadata", "Fluid; assessed by level/condition on dipstick or monitor readout.", "conventional | synthetic_blend | full_synthetic", False),
    ("engine_coolant", "engine coolant", "fluids", "none", "", None, "Separate metadata", "Fluid in cooling system; level at reservoir, freeze point by refractometer/strip.", "oat | hoat | iat | pre_mixed", False),
    ("brake_fluid", "brake fluid", "fluids", "none", "", None, "Separate metadata", "Fluid; level at reservoir, copper/moisture by test strip or tester.", "dot3 | dot4 | dot5_1 | dot5", False),
    ("automatic_transmission_fluid", "automatic transmission fluid", "fluids", "none", "", None, "Separate metadata", "Sealed units may not have a dipstick; mark unable_to_assess rather than guess.", "atf | cvt | dct", False),
    ("manual_transmission_fluid", "manual transmission fluid", "fluids", "none", "", None, "Separate metadata", "Checked at fill plug.", None, False),
    ("power_steering_fluid", "power steering fluid", "fluids", "none", "", None, "Separate metadata", "Not present on electric power steering.", None, False),
    ("differential_fluid", "differential fluid", "fluids", "required_if_multiple_axles", "front | rear | center", None, "Front/rear required when multiple axle locations exist", "Checked at fill plug.", None, False),
    ("transfer_case_fluid", "transfer case fluid", "fluids", "none", "", None, "Separate metadata", "AWD/4WD only.", None, False),
    ("windshield_washer_fluid", "windshield washer fluid", "fluids", "none", "", None, "Separate metadata", None, None, False),
    ("diesel_exhaust_fluid", "diesel exhaust fluid", "fluids", "none", "", None, "Separate metadata", "Diesel with SCR only.", None, False),
    ("windshield_washer_reservoir", "windshield washer reservoir", "washer_wiper", "none", "", None, "Separate metadata", None, None, True),
    ("windshield_washer_pump", "windshield washer pump", "washer_wiper", "optional", "front | rear", None, "Position recommended", "Functional check via spray test.", None, True),
    ("wiper_motor", "wiper motor", "washer_wiper", "required_if_multiple", "front | rear", None, "Front/rear required when more than one", "Functional check via all speeds.", None, True),
    ("wheel_hub_bearing", "wheel hub/bearing", "wheel_end", "required", CORNERS, None, "Corner required", "Assessed by play and noise, not photo.", "hub_assembly | pressed_bearing | tapered_bearing", True),
    ("wheel_lug_nut", "wheel lug nut/bolt", "wheel_end", "required", CORNERS, None, "Corner required", "Record per wheel; missing or damaged studs are findings on this class.", "lug_nut | lug_bolt | wheel_lock", True),
    ("wheel_speed_sensor", "wheel speed sensor", "wheel_end", "required", CORNERS, None, "Corner required", "ABS input; wiring damage and DTCs.", None, True),
    ("tpms_sensor", "TPMS sensor", "wheels_tires", "required", CORNERS, None, "Corner required", "Assessed with TPMS tool.", "direct | indirect", True),
    ("spare_tire", "spare tire", "wheels_tires", "none", "", None, "Separate metadata", "Separate from road tires so the four-corner tire history stays clean.", "full_size | compact | none_inflator_kit", True),
    ("brake_booster", "brake booster", "brake_hydraulics", "none", "", None, "Separate metadata", "Functional check.", "vacuum | hydraulic | electric", True),
    ("parking_brake_control", "parking brake control", "cabin_controls", "none", "", None, "Separate metadata", "Lever, pedal, or electric switch.", "lever | pedal | electric_switch", True),
    ("strut_mount", "strut mount", "suspension", "required", CORNERS, None, "Corner required", None, None, True),
    ("engine_assembly", "engine assembly", "engine", "none", "", None, "Separate metadata", "Whole-engine class for leaks, noise and running condition; does not replace part classes.", None, True),
    ("radiator_cooling_fan", "radiator cooling fan", "cooling", "optional", "left | right | center", None, "Position recommended when dual fans", None, "electric | clutch", True),
    ("alternator", "alternator", "charging_starting", "none", "", None, "Separate metadata", "Output is measured, not seen.", None, True),
    ("starter_motor", "starter motor", "charging_starting", "none", "", None, "Separate metadata", None, None, True),
    ("ac_compressor", "A/C compressor", "hvac", "none", "", None, "Separate metadata", None, "belt_driven | electric", True),
    ("ac_condenser", "A/C condenser", "hvac", "none", "", None, "Separate metadata", None, None, True),
    ("ac_refrigerant_line", "A/C refrigerant line", "hvac", "optional", "any position value", None, "Position recommended", None, "high_side | low_side", True),
    ("cabin_blower_motor", "cabin blower motor", "hvac", "optional", "front | rear", None, "Position recommended", None, None, True),
    ("seat_belt", "seat belt", "occupant_safety", "required", SEATS, None, "Seat position required", "Webbing, latch, retractor.", None, True),
    ("seat", "seat", "cabin", "required", SEATS, None, "Seat position required", None, "bucket | bench | split_bench", True),
    ("steering_wheel", "steering wheel", "cabin_controls", "none", "", None, "Separate metadata", "Used for free-play (lash) measurement.", None, True),
    ("brake_pedal", "brake pedal", "cabin_controls", "none", "", None, "Separate metadata", "Pedal feel/height check.", None, True),
    ("interior_lamp", "interior lamp", "lighting", "optional", "front | center | rear | cargo_area", None, "Position recommended", None, "dome | map | cargo | footwell", True),
    ("backup_camera", "backup camera", "adas", "implied", "rear", None, "Rear implied", None, None, True),
    ("adas_forward_camera", "ADAS forward camera", "adas", "implied", "front", None, "Front implied", "Windshield-mounted; recalibration may be required after glass work.", None, True),
    ("adas_radar_sensor", "ADAS radar sensor", "adas", "required", "front | rear | left_front | right_front | left_rear | right_rear", None, "Position required", None, "long_range | short_range | blind_spot", True),
    ("parking_sensor", "parking sensor", "adas", "required", "front | rear | left_front | right_front | left_rear | right_rear", None, "Position required", "Ultrasonic bumper sensors.", None, True),
    ("high_voltage_battery_pack", "high-voltage battery pack", "ev_high_voltage", "implied", "underbody", None, "Underbody implied", "EV/hybrid only. Do not probe; visual and scan data only.", None, True),
    ("high_voltage_cable", "high-voltage cable", "ev_high_voltage", "optional", "any position value", None, "Position recommended", "Orange cabling. Visual only; do not touch damaged cable.", None, True),
    ("charge_port_inlet", "charge port inlet", "ev_high_voltage", "required", "front | rear | left_front | right_front | left_rear | right_rear", None, "Position required", "Distinct from charge_port_door (closure).", "j1772 | ccs1 | nacs | chademo", True),
    ("electric_drive_unit", "electric drive unit", "ev_high_voltage", "required_if_multiple_axles", "front | rear", None, "Front/rear required when multiple drive units exist", None, None, True),
    ("warning_indicator", "dashboard warning indicator", "controls_context", "none", "", None, "Separate metadata", "One instance per illuminated indicator; subtype identifies which lamp. Rating depends on subtype (see Condition Checks).",
     "check_engine | check_engine_flashing | abs | brake | airbag_srs | oil_pressure | coolant_temperature | charging | tpms | stability_control | power_steering | ev_system | maintenance_reminder", False),
    # ---- added in 1.2.0 (appended so earlier IDs never shift)
    ("thermostat", "thermostat", "cooling", "none", "", None, "Separate metadata", "Usually hidden in its housing; condition comes from warm-up data or DTCs (e.g. P0128). Distinct from thermostat_housing.", "conventional | electronically_controlled", True),
]
ADDED_IN_12 = {"thermostat"}

next_id = max(c["id"] for c in CLASSES) + 1
for (n, disp, cat, code, vals, imp, rule, note, sub, mat) in NEW:
    flags = {k: True for k in FLAG_COLS}
    flags["Position allowed"] = code != "none"
    flags["Position required"] = code == "required"
    flags["Material"] = mat
    if cat == "fluids":
        flags["Bounding box"] = False  # fluid is not a detectable object
        flags["Detection confidence"] = False
    c = dict(id=next_id, name=n, display=disp, category=cat, starter="No", position_rule=rule, note=note,
             added_in="1.2.0" if n in ADDED_IN_12 else "1.1.0", status="active", flags=flags, subtype_examples=sub, map_note=rule,
             position_rule_code=code, allowed_positions=vals if code != "implied" else vals,
             implied_position=vals if code == "implied" else None, new=True)
    CLASSES.append(c)
    BY_NAME[n] = c
    next_id += 1
log("Classes", "New classes", "238 classes (IDs 0–237)", f"{len(CLASSES)} classes (IDs 0–{next_id-1})",
    "Added fluids, wheel-end, charging/starting, HVAC, cabin/occupant safety, ADAS, EV high-voltage and warning-indicator classes a DVI needs. Existing IDs unchanged.",
    "Yes")

# ------------------------------------------------------------ positions for parts that require one (1.4.0)
# These required a position but allowed "any position value", which the app can't offer as a choice, so the part could
# only be added with no position. Each now lists the positions it can have.
POSITIONS_14 = {
    "side_window_glass": "left_front | right_front | left_mid | right_mid | left_rear | right_rear",
    "vent_window_glass": "left_front | right_front | left_rear | right_rear",
    "beltline_molding": "left_front | right_front | left_rear | right_rear",
    "window_molding": "left_front | right_front | left_mid | right_mid | left_rear | right_rear | front | rear",
    "body_cladding": "left | right | front | rear",
    "body_vent": "left | right | front | rear | roof",
    "exterior_lock_cylinder": "left_front | right_front | rear",
    "closure_hinge": "left_front | right_front | left_mid | right_mid | left_rear | right_rear | front | rear",
    "tow_hook": "front | rear",
    "bed_step": "left | right | rear",
    "charge_port_door": "front | rear | left_front | right_front | left_rear | right_rear",
    "exterior_access_hatch": "left | right | front | rear",
    "utility_compartment_door": "left_front | left_mid | left_rear | right_front | right_mid | right_rear",
    "luggage_compartment_door": "left_front | left_mid | left_rear | right_front | right_mid | right_rear",
}
for n, vals in POSITIONS_14.items():
    log("Classes", f"{n}.allowed_positions", BY_NAME[n]["allowed_positions"], vals,
        "A required position needs a list to pick from; 'any position value' left the part with no position.", "No", "1.4.0")
    BY_NAME[n]["allowed_positions"] = vals

# ------------------------------------------------------------ safety critical
SAFETY_CATS = {"brakes", "brake_hydraulics", "steering", "suspension", "wheels_tires", "wheel_end",
               "fuel_system", "exhaust", "occupant_safety", "ev_high_voltage", "adas", "driveline"}
SAFETY_NAMES = {"headlamp", "tail_lamp", "turn_signal_lamp", "reverse_lamp", "high_mount_brake_lamp",
                "license_plate_lamp", "side_marker_lamp", "fog_lamp", "horn", "wiper_blade", "wiper_arm",
                "wiper_motor", "windshield", "rear_window_glass", "side_mirror_glass", "hood_latch",
                "brake_fluid", "brake_pedal", "parking_brake_control", "steering_wheel", "warning_indicator",
                "trailer_hitch_receiver", "tow_hook", "seat", "power_steering_pump", "power_steering_hose",
                "powertrain_mount", "subframe", "tire_placard", "fuel_cap", "fuel_filler_neck", "windshield_washer_fluid"}
NOT_SAFETY = {"tire_placard", "catalytic_converter", "muffler", "exhaust_resonator", "diesel_particulate_filter", "exhaust_sensor"}
for c in CLASSES:
    c["safety_critical"] = (c["category"] in SAFETY_CATS or c["name"] in SAFETY_NAMES) and c["name"] not in NOT_SAFETY
log("Classes", "Safety critical: catalytic_converter, muffler, exhaust_resonator, diesel_particulate_filter, exhaust_sensor", "Yes", "No",
    "Emissions/noise parts, not safety parts (exhaust leaks are still always immediate by rule). Matches the tech rating P0420 as Monitor.", "No", "1.2.0")

# ------------------------------------------------------------ AI photo assessable + capture guidance
PHOTO_CAT = {  # category: (assessable, guidance)
    "identity_context": ("yes", "Straight-on, glare-free photo filling the frame so text/labels are readable."),
    "wheels_tires": ("partial", "One photo per corner: full sidewall incl. DOT code, plus close-up of tread with gauge seated in a main groove. Pressure/age come from measurement, not the photo."),
    "wheel_end": ("partial", "Wheel off or at corner; photo identifies the part. Play, noise and torque are measured, not seen."),
    "controls_context": ("partial", "Dash/cabin photo with ignition on so lamps and gauges are lit."),
    "lighting": ("partial", "Photo shows lens condition; operation is a functional check (photo with lamp lit if possible)."),
    "electrical": ("no", "Functional check; photo only for visible damage."),
    "hood_hardware": ("partial", "Hood open; close photo of latch/striker. Secondary latch operation is functional."),
    "engine_oil": ("yes", "Close photo of component."),
    "cooling": ("yes", "Engine bay photo showing part and any wet/residue areas; close-up of damage."),
    "transmission": ("yes", "Close photo; underbody shots for pans/lines."),
    "power_steering": ("yes", "Close photo showing part and any wet areas."),
    "brake_hydraulics": ("partial", "Close photo of reservoir with MIN/MAX marks visible; booster/master cylinder for leaks."),
    "hoses_belts": ("yes", "Close photo along the belt ribs / hose length; include the area of any crack or wetness."),
    "air_intake": ("yes", "Filter removed, pleated face toward camera in good light."),
    "battery": ("yes", "Top-down photo showing both terminals, hold-down and label/date code."),
    "timing": ("partial", "Usually hidden; service interval drives the rating. Photo only if exposed."),
    "ignition": ("partial", "Photo of removed plug tip/coil if serviced; otherwise interval-based."),
    "cabin_filtration": ("yes", "Filter removed, intake face toward camera."),
    "fuel_system": ("yes", "Close photo of lines/tank/filler; include any wet or rusted areas."),
    "brakes": ("partial", "Wheel off: caliper/rotor face and a close-up of the pad edge with gauge. Thickness is measured; photo supports it."),
    "suspension": ("partial", "Underbody photo at the corner showing the part and any leak/tear. Play is measured on the lift, not seen."),
    "steering": ("partial", "Underbody photo at the side; boots in close-up. Play is a hands-on check."),
    "driveline": ("partial", "Underbody close-up of boots/joints; play is a hands-on check."),
    "powertrain_underbody": ("yes", "Underbody photo showing seams/gaskets and any wet or residue areas."),
    "exhaust": ("partial", "Underbody photo along the pipe; close-up of rust-through, hangers and joints. Leaks are confirmed by sound/smoke."),
    "body_panel": ("yes", "Walk-around photos at ~45° showing whole panel, then close-ups of damage."),
    "closure": ("yes", "Panel photo from outside; open to show hinges/latch if damaged."),
    "fascia": ("yes", "Straight-on and 45° photos of front/rear."),
    "aero": ("yes", "Low-angle photo of the part."),
    "glass": ("yes", "Photo from outside and inside against a plain background; ruler or coin next to chips/cracks for size."),
    "roof": ("yes", "Elevated photo of the roof surface."),
    "mirror": ("yes", "Close photo of housing/glass."),
    "trim": ("yes", "Close photo of the trim piece."),
    "protection": ("yes", "Underbody/wheel-well photo showing mounting points."),
    "hardware": ("yes", "Close photo of the part."),
    "towing": ("yes", "Close photo of receiver/hook/connector."),
    "roof_cargo": ("yes", "Elevated photo."),
    "pickup": ("yes", "Photo of bed/part."),
    "cargo": ("yes", "Close photo."),
    "commercial_rv": ("yes", "Close photo."),
    "commercial": ("yes", "Close photo along the side."),
    "step_guard": ("yes", "Photo from the side/front."),
    "fluids": ("partial", "Photo of dipstick on a white shop towel, or reservoir with MIN/MAX marks; test strip next to its color chart. Level/test value is recorded as a measurement."),
    "washer_wiper": ("partial", "Photo for damage; operation is a functional check."),
    "charging_starting": ("no", "Measured with tester; photo only for visible damage/leaks."),
    "hvac": ("partial", "Photo for damage/oil residue; performance is measured (vent temperature)."),
    "occupant_safety": ("partial", "Photo of webbing pulled out and the buckle; latch/retract is functional."),
    "cabin": ("yes", "Photo of seat surfaces and mounting."),
    "cabin_controls": ("no", "Functional check (feel/travel)."),
    "adas": ("partial", "Photo of sensor face/lens and mounting; calibration/faults come from scan tool."),
    "ev_high_voltage": ("partial", "Visual only from a safe distance; do not touch damaged HV parts. State of health from scan tool."),
    "engine": ("partial", "Engine bay and underbody photos of leak areas; running condition is a functional check."),
}
OVERRIDES = {
    "horn": ("no", "Functional check."),
    "warning_indicator": ("yes", "Ignition on, engine running: photo of the instrument cluster with the lamp lit."),
    "instrument_cluster": ("yes", "Ignition on, engine running: full cluster including odometer."),
    "engine_oil": ("partial", "Dipstick on a white shop towel showing both marks, or oil-life screen."),
    "brake_pad": ("partial", "Close-up of pad edge with pad gauge or ruler; inner and outer if visible."),
    "tire": ("partial", "Tread close-up with gauge in a main groove; full sidewall incl. DOT code."),
    "windshield": ("yes", "From outside and inside; coin/ruler next to damage; show where it sits relative to the driver's view."),
    "wheel_lug_nut": ("yes", "Close photo showing all nuts on the wheel."),
    "tire_placard": ("yes", "Door-jamb placard straight on."),
    "vehicle_exterior": ("yes", "Walk-around photos at about 45° from each corner, then close-ups of any existing damage."),
    "cv_boot": ("yes", "Close-up around the full boot circumference; grease splatter nearby."),
    "shock_absorber": ("yes", "Close-up of the body showing any oil film or wetness."),
    "strut_assembly": ("yes", "Close-up of the body showing any oil film or wetness."),
    "coil_spring": ("yes", "Full spring, both ends visible."),
}
for c in CLASSES:
    a, g = PHOTO_CAT.get(c["category"], ("yes", "Close photo of the part."))
    if c["name"] in OVERRIDES:
        a, g = OVERRIDES[c["name"]]
    c["ai_photo"] = a
    c["capture"] = g
