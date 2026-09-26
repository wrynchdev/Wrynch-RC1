"""Starter Wrynch template: stages → inspection points → components (class + position)."""
from checks import BY_NAME

C4 = ["left_front", "right_front", "left_rear", "right_rear"]
F2 = ["left_front", "right_front"]
R2 = ["left_rear", "right_rear"]
LR = ["left", "right"]
N = [None]

# stage key, stage name, stage instructions (bulk capture)
STAGES = [
    ("checkin", "Check-in & identity", "Capture VIN label, odometer/cluster with engine running, and door-jamb placard in one burst."),
    ("exterior", "Exterior walk-around", "Walk the car once, photographing each corner and side at ~45°, then close-ups of any damage."),
    ("lighting", "Lights & electrical", "With a helper or mirror, operate each lamp; photograph any lamp that is out or damaged."),
    ("underhood", "Under hood", "Hood open: wide shot, then dipstick on towel, reservoirs with marks visible, battery top, belt and hoses."),
    ("wheels_brakes", "Tires, wheels & brakes", "Vehicle on lift, wheels off: per corner shoot tire tread with gauge, sidewall/DOT, caliper/rotor face, pad edge with gauge."),
    ("steer_susp", "Steering & suspension", "Per corner: strut/shock, spring, ball joints, tie rod ends, links, boots. Photograph anything wet, torn or broken."),
    ("underbody", "Underbody & drivetrain", "Walk under the car front to rear: axles/boots, driveshaft, transmission, differential, exhaust, fuel lines."),
    ("interior", "Interior & cabin", "Seat belts, wipers/washers, HVAC, pedals, horn, mirrors, cameras."),
    ("ev_hv", "EV / hybrid high-voltage", "Only for EV/PHEV/HEV. Visual from a safe distance; scan data for battery health."),
]

# point key, stage, name, point instruction, [(class, positions, required, applies_when)]
P = []


def pt(key, stage, name, instr, comps):
    P.append(dict(key=key, stage=stage, name=name, instr=instr, comps=comps))


A = "all"
pt("vin", "checkin", "VIN & vehicle identity", "Photo of VIN label or windshield VIN.", [("vin_label", N, "Yes", A)])
pt("dash", "checkin", "Dash warning lights & mileage", "Engine running; photo of cluster.", [("instrument_cluster", N, "Yes", A), ("warning_indicator", N, "No", "when an indicator is lit (one instance per lamp)")])
pt("placard", "checkin", "Tire placard", "Driver door jamb.", [("tire_placard", N, "Yes", A)])

pt("front_ext", "exterior", "Front of vehicle", "Straight-on and both front corners.",
   [("bumper", ["front"], "Yes", A), ("fascia_panel", ["front"], "No", A), ("grille", N, "No", A), ("hood", N, "Yes", A), ("license_plate", ["front"], "No", "front plate state")])
pt("left_side", "exterior", "Driver side", "Front to rear along the driver side.",
   [("fender", ["left_front"], "Yes", A), ("door", ["left_front", "left_rear"], "Yes", "rear doors when equipped"), ("quarter_panel", ["left_rear"], "Yes", A),
    ("rocker_panel", ["left"], "No", A), ("side_mirror_housing", ["left"], "Yes", A), ("side_mirror_glass", ["left"], "Yes", A)])
pt("rear_ext", "exterior", "Rear of vehicle", "Straight-on and both rear corners.",
   [("bumper", ["rear"], "Yes", A), ("trunk_lid", N, "No", "sedan"), ("liftgate", N, "No", "SUV/hatch"), ("tailgate", N, "No", "pickup"), ("license_plate", ["rear"], "Yes", A)])
pt("right_side", "exterior", "Passenger side", "Rear to front along the passenger side.",
   [("quarter_panel", ["right_rear"], "Yes", A), ("door", ["right_front", "right_rear"], "Yes", "rear doors when equipped"), ("fender", ["right_front"], "Yes", A),
    ("rocker_panel", ["right"], "No", A), ("side_mirror_housing", ["right"], "Yes", A), ("side_mirror_glass", ["right"], "Yes", A)])
pt("glass_roof", "exterior", "Glass & roof", "Windshield inside and out; roof from a step.",
   [("windshield", N, "Yes", A), ("rear_window_glass", N, "No", A), ("roof_panel", N, "No", A), ("roof_glass", N, "No", "sunroof when equipped")])

pt("headlamps", "lighting", "Headlamps (low/high) & aim", "Operate low and high beam.", [("headlamp", LR, "Yes", A)])
pt("signals", "lighting", "Turn signals & hazards", "Operate left, right and hazard.", [("turn_signal_lamp", C4, "Yes", A)])
pt("brake_lamps", "lighting", "Brake, tail & reverse lamps", "Helper or mirror.",
   [("tail_lamp", LR, "Yes", A), ("high_mount_brake_lamp", N, "Yes", A), ("reverse_lamp", LR, "Yes", A), ("license_plate_lamp", N, "Yes", A)])
pt("other_lamps", "lighting", "Fog & marker lamps", None, [("fog_lamp", LR, "No", "fog lamps when equipped"), ("side_marker_lamp", C4, "No", A)])
pt("horn", "lighting", "Horn", None, [("horn", N, "Yes", A)])

pt("engine_oil", "underhood", "Engine oil", "Dipstick on white towel, or oil-life screen.", [("engine_oil", N, "Yes", A)])
pt("coolant", "underhood", "Coolant level & protection", "Reservoir with marks; refractometer reading.",
   [("engine_coolant", N, "Yes", A), ("coolant_reservoir", N, "No", A), ("coolant_pressure_cap", N, "No", A)])
pt("brake_fluid", "underhood", "Brake fluid", "Reservoir marks; test strip next to chart.", [("brake_fluid", N, "Yes", A), ("brake_fluid_reservoir", N, "No", A)])
pt("other_fluids", "underhood", "Other fluids", None,
   [("automatic_transmission_fluid", N, "No", "automatic transmission"), ("power_steering_fluid", N, "No", "hydraulic power steering"),
    ("windshield_washer_fluid", N, "Yes", A), ("diesel_exhaust_fluid", N, "No", "diesel with SCR")])
pt("battery", "underhood", "Battery & charging", "Battery top photo + tester printout.",
   [("low_voltage_battery", N, "Yes", "12 V battery accessible"), ("battery_terminal", N, "Yes", "12 V battery accessible"),
    ("battery_hold_down", N, "No", A), ("alternator", N, "No", "combustion engine")])
pt("belts_hoses", "underhood", "Belts & hoses", "Along the belt ribs and each hose.",
   [("accessory_drive_belt", N, "Yes", "combustion engine"), ("belt_tensioner", N, "No", "combustion engine"), ("coolant_hose", N, "No", A), ("radiator", N, "No", A)])
pt("filters", "underhood", "Air filters", "Filters removed, face to camera.", [("engine_air_filter", N, "Yes", "combustion engine"), ("cabin_air_filter", N, "No", A)])
pt("engine_leaks", "underhood", "Engine leaks & running condition", None, [("engine_assembly", N, "Yes", "combustion engine"), ("powertrain_mount", N, "No", A)])
pt("hood_latch", "underhood", "Hood latch", None, [("hood_latch", N, "No", A)])

pt("tires", "wheels_brakes", "Tires", "Per corner: tread with gauge, full sidewall incl. DOT code.", [("tire", C4, "Yes", A)])
pt("wheels", "wheels_brakes", "Wheels & lug nuts", None, [("wheel", C4, "Yes", A), ("wheel_lug_nut", C4, "Yes", A), ("tire_valve_stem", C4, "No", A)])
pt("tpms", "wheels_brakes", "TPMS sensors", "TPMS tool screen.", [("tpms_sensor", C4, "No", "direct TPMS")])
pt("spare", "wheels_brakes", "Spare tire", None, [("spare_tire", N, "No", "spare equipped")])
pt("front_brakes", "wheels_brakes", "Front brakes", "Per front corner: pad edge with gauge, rotor face, caliper.",
   [("brake_pad", F2, "Yes", A), ("brake_rotor", F2, "Yes", A), ("brake_caliper", F2, "No", A), ("brake_hose", F2, "No", A)])
pt("rear_brakes_disc", "wheels_brakes", "Rear brakes (disc)", "Per rear corner.",
   [("brake_pad", R2, "Yes", "rear disc brakes"), ("brake_rotor", R2, "Yes", "rear disc brakes"), ("brake_caliper", R2, "No", "rear disc brakes"), ("brake_hose", R2, "No", "rear disc brakes")])
pt("rear_brakes_drum", "wheels_brakes", "Rear brakes (drum)", "Drum removed.",
   [("brake_shoe", R2, "Yes", "rear drum brakes"), ("brake_drum", R2, "Yes", "rear drum brakes"), ("brake_wheel_cylinder", R2, "No", "rear drum brakes")])
pt("brake_lines", "wheels_brakes", "Brake lines", None, [("brake_line", N, "No", A)])

pt("front_susp", "steer_susp", "Front suspension", "The tech checks the parts, not the 'front suspension': struts/shocks, springs, ball joints, arms, links, mounts.",
   [("strut_assembly", F2, "Yes", "front struts"), ("shock_absorber", F2, "Yes", "front shocks (non-strut)"), ("coil_spring", F2, "Yes", A),
    ("ball_joint", F2, "Yes", A), ("control_arm", F2, "No", A), ("suspension_bushing", F2, "No", A), ("sway_bar_link", F2, "No", A), ("strut_mount", F2, "No", "front struts")])
pt("rear_susp", "steer_susp", "Rear suspension", None,
   [("shock_absorber", R2, "Yes", "rear shocks"), ("strut_assembly", R2, "Yes", "rear struts"), ("coil_spring", R2, "No", "rear coil springs"),
    ("leaf_spring", R2, "No", "rear leaf springs"), ("control_arm", R2, "No", A), ("sway_bar_link", R2, "No", A)])
pt("steering", "steer_susp", "Steering linkage", None,
   [("outer_tie_rod_end", LR, "Yes", A), ("inner_tie_rod", LR, "Yes", A), ("steering_rack_boot", LR, "No", "rack-and-pinion"), ("steering_rack", N, "No", "rack-and-pinion"),
    ("steering_wheel", N, "Yes", A)])
pt("hub_bearings", "steer_susp", "Wheel bearings", "Rock and spin test.", [("wheel_hub_bearing", C4, "Yes", A)])

pt("axles", "underbody", "CV axles & boots", "Close-ups all the way around each boot.",
   [("cv_boot", F2, "Yes", "FWD/AWD front axles"), ("cv_axle", F2, "No", "FWD/AWD front axles"), ("cv_boot", R2, "No", "independent rear drive axles")])
pt("driveshaft", "underbody", "Driveshaft & U-joints", None,
   [("driveshaft", ["rear"], "No", "RWD/AWD/4WD"), ("universal_joint", N, "No", "RWD/AWD/4WD"), ("driveshaft_support_bearing", N, "No", "two-piece driveshaft")])
pt("diff_tcase", "underbody", "Differential & transfer case", None,
   [("differential_fluid", ["rear"], "No", "rear differential"), ("differential_fluid", ["front"], "No", "4WD/AWD front differential"),
    ("transfer_case_fluid", N, "No", "4WD/AWD with transfer case"), ("differential_housing", ["rear"], "No", "rear differential")])
pt("trans_under", "underbody", "Transmission & oil pan (leaks)", None,
   [("transmission_pan", N, "No", "automatic transmission"), ("engine_oil_pan", N, "Yes", "combustion engine"), ("transmission_cooler_line", N, "No", A)])
pt("exhaust", "underbody", "Exhaust system", "Front to rear; note any leak ahead of the cabin.",
   [("exhaust_pipe", N, "Yes", "combustion engine"), ("catalytic_converter", N, "No", "combustion engine"), ("muffler", N, "No", "combustion engine"),
    ("exhaust_hanger", N, "No", "combustion engine"), ("exhaust_heat_shield", N, "No", "combustion engine")])
pt("fuel_lines", "underbody", "Fuel tank & lines", None, [("fuel_tank", N, "No", "combustion engine"), ("fuel_line", N, "No", "combustion engine")])
pt("underbody_shields", "underbody", "Splash shields & subframe", None, [("underbody_splash_shield", N, "No", A), ("subframe", ["front"], "No", A)])

pt("seat_belts", "interior", "Seat belts", "Pull, latch, release each.", [("seat_belt", ["left_front", "right_front", "left_rear", "center", "right_rear"], "Yes", "rear positions per seating")])
pt("wipers", "interior", "Wipers & washers", "Wet glass test.",
   [("wiper_blade", ["left_front", "right_front"], "Yes", A), ("wiper_motor", ["front"], "No", A), ("windshield_washer_pump", ["front"], "No", A), ("wiper_blade", ["rear"], "No", "rear wiper equipped")])
pt("hvac", "interior", "Heating & A/C", "Thermometer in center vent, max A/C.", [("cabin_air_vent", ["center"], "Yes", A), ("cabin_blower_motor", N, "No", A)])
pt("pedals", "interior", "Brake pedal & parking brake", None, [("brake_pedal", N, "Yes", A), ("parking_brake_control", N, "Yes", A)])
pt("cameras", "interior", "Backup camera & driver aids", None, [("backup_camera", N, "No", "backup camera equipped"), ("adas_forward_camera", N, "No", "ADAS equipped")])

pt("hv_battery", "ev_hv", "HV battery pack", "Underbody visual + scan SOH.", [("high_voltage_battery_pack", N, "Yes", "EV/PHEV/HEV")])
pt("hv_cables", "ev_hv", "HV cabling", "Visual only.", [("high_voltage_cable", N, "Yes", "EV/PHEV/HEV")])
pt("charge_port", "ev_hv", "Charge port", None, [("charge_port_inlet", ["left_front"], "No", "BEV/PHEV (set actual location)")])

TEMPLATE_ROWS = []  # one row per expected component instance
for i, p in enumerate(P, 1):
    p["id"] = f"P{i:02d}"
    for (cls, poss, req, when) in p["comps"]:
        c = BY_NAME[cls]
        for pos in poss:
            pos_out = pos if pos else (c.get("implied_position") or "")
            TEMPLATE_ROWS.append(dict(pid=p["id"], stage=p["stage"], point=p["name"], cid=c["id"], cname=cls,
                                      position=pos_out, required=req, when=when,
                                      checks=" | ".join(c["check_keys"]), role="identification" if c["category"] == "identity_context" else ("measurement" if c["category"] == "fluids" else "condition")))
