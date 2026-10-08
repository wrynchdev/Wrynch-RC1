"""What to look for on each part's "Visual condition" check (shown to the technician as the check's 'how', and given
to the photo AI). Written per component; a part whose visual check would tell the technician nothing its other checks
don't already cover is in REMOVE and gets no visual check. Every part must keep at least one check."""

LOOK_FOR = {
    # identity and context photos
    "vehicle_exterior": "Existing dents, scratches, cracked glass or lenses, missing trim, mismatched paint from prior repairs, before work starts",
    "vin_label": "Label present and readable, not peeling or painted over, VIN matches the dash and the repair order",
    "vin_stamping": "Stamping readable and not ground, re-stamped or covered by rust, VIN matches the label",
    "tire_placard": "Placard present and readable on the door jamb, tire size and cold pressures legible",
    # cabin controls
    "instrument_cluster": "Cracked or hazy lens, dead pixels or segments, dim backlight, warning lights still on after start",
    "wiper_blade": "Torn or split rubber edge, rubber lifting from the frame, hardened or cracked rubber, bent frame, streaks left after a wipe",
    "wiper_arm": "Bent arm (blade not flat on glass), weak spring, loose nut at the pivot, rust, missing cap",
    "hvac_control_panel": "Cracked or missing knobs, buttons that stick, dead display segments, settings that don't respond",
    "cabin_air_vent": "Broken louvers or tabs, vents that won't hold position, blocked or missing vent, weak airflow at that vent",
    "horn": "Horn bracket bent or loose, horn rusted through, connector corroded or unplugged",
    # hood hardware
    "hood_latch": "Latch rusted or dry, bent or cracked latch, loose mounting bolts, secondary catch that doesn't spring back",
    "hood_striker": "Bent or cracked striker loop, worn groove, loose or misaligned striker so the hood doesn't latch flush",
    "hood_release_cable": "Frayed or kinked cable, broken handle, cable sheath cracked, too much slack to pop the latch",
    # engine oil
    "engine_oil_dipstick": "Bent or kinked stick, missing or broken handle, unreadable marks, tube loose or cracked",
    "engine_oil_fill_cap": "Missing cap, cracked cap, torn or flattened seal, oil residue around the filler neck, sludge under the cap",
    # cooling
    "coolant_reservoir": "Cracked or yellowed tank, coolant crust at seams or the cap, oil film on the coolant, missing or broken mounts",
    "coolant_pressure_cap": "Torn, hardened or swollen seal, weak or rusted spring, crust or residue around the cap seat",
    "radiator": "Bent or blocked fins, bugs or debris, coolant crust or green/pink residue at seams, cracked plastic tanks, wet or rusted core",
    "coolant_hose": "Cracks, swelling, soft or mushy spots, collapsed sections, chafing, crust or wetness at the clamps, rusted clamps",
    "water_pump": "Coolant crust or drips at the weep hole, wet streaks below the pump, pulley wobble, bearing noise",
    "thermostat_housing": "Coolant crust or seepage at the gasket, cracked plastic housing, corroded aluminum housing, loose bolts",
    # transmission
    "transmission_dipstick": "Bent or missing stick, cracked tube, missing seal, unreadable marks",
    "transmission_fill_plug": "Wet fluid around the plug, rounded plug, missing or damaged washer",
    "transmission_pan": "Wet gasket line, fluid drips, dented or rusted pan, loose or missing bolts",
    "transmission_cooler_line": "Wet fittings, rusted or kinked lines, chafing against the frame, cracked rubber sections, loose clips",
    # power steering
    "power_steering_reservoir": "Cracked reservoir, fluid around the cap, foamy or dark fluid, loose mount",
    "power_steering_pump": "Fluid seeping from the shaft seal or fittings, wet underside, pulley wobble, whine",
    "power_steering_hose": "Wet or oily crimp fittings, swelling, cracked cover, chafing, hardened hose",
    # brake hydraulics
    "brake_fluid_reservoir": "Cracked or cloudy reservoir, fluid around the cap or grommets, damaged cap seal, missing level sensor",
    "brake_master_cylinder": "Fluid seeping at the booster joint or line fittings, wet paint below the master cylinder, corroded fittings",
    # hoses and belts
    "vacuum_hose": "Cracked, hardened or collapsed hose, split ends, disconnected or loose fit, hissing",
    "accessory_drive_belt": "Cracks across the ribs, missing chunks, fraying edges, glazing, oil or coolant on the belt, belt off the pulley edge",
    "belt_tensioner": "Tensioner arm outside its marks, arm bouncing at idle, rust trail at the pivot, pulley wobble, rough bearing",
    "idler_pulley": "Pulley wobble, rough or noisy bearing, cracked plastic pulley, belt dust around the pulley",
    # air intake
    "engine_air_filter_housing": "Cracked housing, broken or missing clips, warped lid that doesn't seal, debris or water inside",
    "engine_air_intake_duct": "Cracks or splits (often at the bellows), loose clamps, collapsed sections, rodent damage",
    # battery
    "low_voltage_battery": "Swollen or cracked case, acid leaks or wet top, corrosion at the posts, date code older than 4–5 years",
    "battery_cable": "Green or white corrosion under the insulation, swollen cable near the clamp, cracked or melted insulation, loose clamp",
    "battery_hold_down": "Missing or broken hold-down, battery that moves by hand, rusted tray or rod",
    # timing
    "timing_belt": "Where it can be seen: cracks, fraying edges, missing teeth, oil or coolant on the belt, belt service sticker",
    "timing_chain": "With the valve cover off: slack chain, hooked or worn sprocket teeth, plastic guide pieces in the oil",
    "timing_cover": "Oil seeping at the cover gasket or crank seal, cracked cover, missing bolts",
    "timing_tensioner": "With the timing cover off: tensioner extended past its limit, oil weeping from a hydraulic tensioner, pulley wobble",
    "timing_chain_guide": "With the valve cover or timing cover off: grooves worn through the guide face, cracked or broken guide, pieces in the oil",
    # ignition
    "spark_plug": "When removed: worn or rounded electrode, wide gap, oil or carbon fouling, white blistered insulator, cracked porcelain",
    "ignition_coil": "Cracked coil body, carbon tracking lines, oil in the plug well, corroded or loose connector, melted boot",
    "spark_plug_wire": "Cracked or burned boots, carbon tracking, chafed insulation, wires touching the exhaust, loose ends",
    # cabin filtration
    "cabin_air_filter_access_cover": "Broken tabs, cover that won't stay closed, missing cover, leaves or water behind it",
    # fuel
    "fuel_cap": "Missing cap or tether, cracked cap, torn or flattened seal, cap that won't click",
    "fuel_filter": "Wet fittings, fuel odor, rusted filter body or brackets, cracked plastic housing",
    "fuel_rail": "Wet fittings or injector seats, fuel odor, cracked plastic rail, rubbed or kinked feed line",
    "fuel_injector": "Wet injector seats or O-rings, fuel odor, cracked connector, broken retaining clips",
    "fuel_pump": "Wet or rusted pump flange or lines, fuel odor at the pump access, corroded connector",
    # brakes
    "brake_caliper": "Fluid on the caliper or inside the wheel, torn piston boot, seized slide pins (uneven pad wear), cracked or missing hardware",
    "brake_pad": "Glazed or cracked friction material, lining separating from the backing plate, oil or fluid contamination, missing shims or clips",
    "brake_drum": "Scoring or grooves, blue heat spots, cracks, lip worn to a ridge, rust on the friction surface",
    "brake_shoe": "Glazed, cracked or oil-soaked lining, lining separating from the shoe, broken return springs or hold-downs",
    "brake_backing_plate": "Rust-through, bent plate rubbing the drum or rotor, grooves worn by the shoes, missing bolts",
    "parking_brake_cable": "Frayed or rusted cable, cracked sheath, seized cable that doesn't return, broken or missing clips",
    "brake_wheel_cylinder": "Wet or crusty boots, fluid on the shoes or drum, torn boots, seized pistons",
    # suspension
    "torsion_bar": "Rust pitting or cracks, bent bar, worn or missing adjuster bolts, uneven ride height side to side",
    "ball_joint": "Torn or missing boot, grease thrown on nearby parts, rust at the stud, missing cotter pin",
    "sway_bar": "Cracked or broken bar, bent bar, worn or split bushings, broken or missing end links",
    "steering_knuckle": "Cracks, bent arms, worn or damaged threads, damaged ABS sensor mount",
    "subframe": "Rust-through or heavy scale, cracks at the welds, bent sections from impact, torn or missing mount bushings, loose bolts",
    "bump_stop": "Missing, split or crushed bump stop, signs it's bottoming (shiny contact marks)",
    # steering
    "outer_tie_rod_end": "Torn or missing boot, grease leaking out, missing cotter pin, bent shaft, rust at the stud",
    "inner_tie_rod": "Torn rack boot, fluid or grease inside the boot, bent rod, loose jam nut",
    "tie_rod_adjusting_sleeve": "Rusted or seized sleeve, bent sleeve, loose or missing clamps",
    "steering_rack": "Fluid in or around the rack boots, torn boots, wet fittings, loose or broken mount bushings",
    "steering_gearbox": "Fluid seeping at the seals or fittings, wet underside, loose mounting bolts, cracked frame at the mount",
    "pitman_arm": "Torn boot, grease leaking out, bent arm, loose nut or missing cotter pin",
    "idler_arm": "Torn boot, loose or worn bushing, bent arm, loose bracket bolts",
    "center_link": "Torn boots at the joints, bent link, missing cotter pins, rust at the joints",
    "drag_link": "Torn boots at the joints, bent link, missing cotter pins, rust at the joints",
    "steering_shaft": "Torn or missing boot at the firewall, loose pinch bolts, rust on the U-joints",
    "steering_stabilizer": "Fluid leaking from the damper, bent shaft, worn bushings, loose mounting",
    # driveline
    "cv_axle": "Bent shaft, grease thrown around the wheel well, rust or damage at the joints, missing clamps",
    "driveshaft": "Dents or bends, missing balance weights, heavy rust, undercoating or debris stuck on the shaft",
    "universal_joint": "Rust dust around the caps (dry joint), missing grease fitting cap, cracked seals, play when twisted by hand",
    "driveshaft_support_bearing": "Torn or sagging rubber, separated bearing mount, rust dust, loose bracket bolts",
    "driveshaft_flex_disc": "Cracks in the rubber, bulging between the bolts, missing or loose bolts",
    "axle_housing": "Fluid at the axle seals or tube welds, cracked or bent tubes, rust-through, damaged spring perches",
    # powertrain underbody
    "engine_oil_pan": "Wet gasket line or drips, dents from impact, cracked aluminum pan, rusted steel pan",
    "engine_oil_filter": "Oil wet around the filter base, dented filter, double gasket, oil change sticker overdue",
    "engine_drain_plug": "Wet around the plug, rounded plug, stripped or oversized plug, missing washer",
    "valve_cover": "Oil seeping at the gasket or spark plug tubes, cracked plastic cover, oil running down the head",
    "engine_front_cover": "Oil seeping at the cover gasket or crank seal, oil sling around the balancer",
    "oil_cooler": "Oil or coolant wet at the cooler or its lines, oil in the coolant or coolant in the oil, damaged fins",
    "transmission_housing": "Fluid seeping at the bell housing, seams or seals, cracked case, broken mount",
    "differential_housing": "Fluid seeping at the pinion seal or axle seals, cracked housing, rust-through",
    "differential_cover": "Wet gasket line or drips, dented cover from impact, loose bolts",
    "transfer_case": "Fluid at the input and output seals or the case seam, cracked case, damaged shift linkage",
    "power_transfer_unit": "Fluid at the seals or seam, burnt-oil smell, cracked housing",
    "differential_fill_plug": "Wet around the plug, rounded plug, missing plug",
    "differential_drain_plug": "Wet around the plug, rounded plug, missing plug",
    # exhaust
    "diesel_particulate_filter": "Soot streaks at the joints or tailpipe, cracked housing, damaged pressure sensor lines",
    "exhaust_hanger": "Torn, stretched or missing rubber, broken hanger rod, exhaust sagging or touching the body",
    "exhaust_heat_shield": "Loose or rattling shield, rusted-through mounts, shield missing or touching the exhaust",
    "exhaust_clamp": "Rusted-through or loose clamp, soot at the joint, missing clamp",
    "exhaust_flange": "Soot trails at the joint, broken or rusted studs, blown gasket",
    "exhaust_sensor": "Damaged or melted wiring, connector touching the exhaust, soot around the sensor threads",
    # body
    "hood": "Dents, scratches, chips along the leading edge, rust at the edges, misalignment with the fenders",
    "roof_panel": "Dents (hail), clear coat peeling, rust at the edges or seams, scratches",
    "fender": "Dents, scratches, rust at the wheel lip, misaligned gaps",
    "quarter_panel": "Dents, scratches, rust at the wheel lip, signs of prior repair",
    "rocker_panel": "Rust bubbling or rust-through, dents from jacking or impact, stone chips",
    "door": "Dents, scratches, rust at the bottom edge, misaligned gaps, door sagging when opened",
    "cowl_panel": "Cracked or broken cowl panel, leaves and debris blocking the drains, missing clips",
    "rear_body_panel": "Dents, scratches, rust, prior repair or misaligned gaps",
    "cab_corner": "Rust bubbling or rust-through, dents, prior repair",
    "pickup_bed_side_panel": "Dents, rust at the wheel arch and edges, scratches",
    "pickup_bed_floor": "Rust-through, dents, holes, water pooling",
    "cargo_body_panel": "Dents, cracks, rust, loose rivets or panels",
    # closures
    "trunk_lid": "Dents, rust at the edges, weak struts or torsion springs, latch that doesn't catch, torn seal",
    "liftgate": "Dents, rust at the edges, weak struts (gate won't stay up), latch or power-close fault, torn seal",
    "tailgate": "Dents, worn or broken support cables, latch that doesn't catch, rust at the edges",
    "sliding_door": "Dents, door that drags or binds on the track, worn rollers, latch fault, torn seal",
    "rear_barn_door": "Dents, sagging hinges, broken door checks, latch that doesn't catch, torn seal",
    "cargo_rollup_door": "Dents or bent slats, frayed cable or straps, door that binds in the track, broken latch",
    "utility_compartment_door": "Dents, broken latch or lock, sagging hinge, torn seal letting water in",
    "exterior_access_hatch": "Missing or broken hatch, latch that doesn't hold, damaged hinge",
    "fuel_filler_door": "Door that won't open or stay closed, broken hinge or release, missing door",
    "charge_port_door": "Door that won't open or close, broken hinge or latch, missing door",
    # fascia and aero
    "bumper": "Cracks, broken tabs, sagging or misaligned cover, scuffs, damaged parking sensors",
    "fascia_panel": "Cracks, broken mounting tabs, gaps or sagging",
    "grille": "Cracked or broken bars, missing emblem or clips, debris behind it blocking the radiator",
    "active_grille_shutter": "Broken or stuck vanes, debris holding the shutters, damaged actuator",
    "valance_panel": "Cracks, broken or missing clips, scraping damage, hanging low",
    "air_dam": "Cracks, missing pieces, scraping damage, loose or hanging",
    "splitter": "Cracks, scrape damage, loose mounting",
    "diffuser": "Cracks, scrape damage, loose mounting",
    "spoiler": "Cracks, loose mounting, faded or peeling finish",
    "wing": "Cracks, loose mounting, damaged end plates",
    "side_skirt": "Cracks, scrape damage, loose or missing clips",
    "aerodynamic_side_fairing": "Cracks, missing panels, loose or broken brackets",
    "cab_roof_fairing": "Cracks, loose mounting, missing extenders",
    # glass
    "windshield": "Sand pitting and wiper haze in the driver's view, edge delamination, loose or missing molding",
    "rear_window_glass": "Chips or cracks, broken defroster lines, delamination at the edges",
    "side_window_glass": "Chips or cracks, deep scratches, glass that rattles or doesn't seal",
    "quarter_window_glass": "Chips or cracks, failed seal (water or wind noise)",
    "vent_window_glass": "Chips or cracks, broken latch, failed seal",
    "roof_glass": "Chips or cracks, failed seal, water stains on the headliner",
    # roof
    "convertible_soft_top": "Tears or holes, cloudy or cracked rear window, worn seams, torn seals, frame that binds",
    "removable_hardtop": "Cracks, damaged latches, torn seals, water leaks",
    # mirrors and trim
    "side_mirror_housing": "Cracked or missing cover, loose mirror, broken fold mechanism, damaged signal lens",
    "body_cladding": "Cracks, faded plastic, loose or missing clips",
    "fender_flare": "Cracks, loose or missing fasteners, rust trapped under the flare",
    "wheel_arch_molding": "Cracks, loose or missing clips, rust trapped under the molding",
    "body_side_molding": "Loose or peeling molding, missing pieces",
    "rocker_molding": "Cracks, loose or missing clips, rust trapped behind",
    "beltline_molding": "Cracked, peeling or loose molding, worn felt that scratches the glass",
    "window_molding": "Cracked, shrunk or loose molding, gaps that let water in",
    "windshield_molding": "Cracked, shrunk or loose molding, gaps at the corners",
    "drip_rail": "Rust, loose or missing trim",
    "door_edge_guard": "Loose, cracked or missing guard",
    "stone_guard": "Peeling or torn film, missing guard, chips underneath",
    # protection
    "mud_flap": "Torn or missing flap, loose or missing fasteners, flap rubbing the tire",
    "splash_guard": "Torn or missing guard, loose fasteners",
    "wheelhouse_liner": "Torn, loose or missing liner, liner rubbing the tire, missing fasteners",
    "underbody_splash_shield": "Torn, loose or missing shield, hanging low, missing fasteners, oil soaked",
    "skid_plate": "Dents or bends from impact, cracked mounts, loose or missing bolts",
    # hardware
    "exterior_door_handle": "Broken or loose handle, handle that doesn't open the door, damaged keypad or sensor",
    "exterior_lock_cylinder": "Key won't turn, damaged or missing cylinder, corrosion",
    "closure_hinge": "Rust, worn pins (door or lid sags), dry or noisy hinge, cracked mounts",
    "hood_scoop": "Cracks, loose mounting, blocked opening",
    "body_vent": "Cracks, broken louvers, loose or missing vent",
    "washer_nozzle": "Clogged or misaimed nozzle, cracked nozzle, broken hose underneath",
    "antenna": "Bent or broken mast, cracked base, loose mount",
    "emblem": "Missing, peeling or cracked emblem",
    "nameplate_badge": "Missing, peeling or cracked badge",
    "license_plate": "Missing or unreadable plate, expired registration sticker",
    "license_plate_bracket": "Cracked or broken bracket, missing screws, loose plate",
    "tow_hook": "Bent hook, cracked or rusted mount, loose bolts, missing hook",
    "trailer_electrical_connector": "Corroded or bent pins, cracked housing, missing cover, chafed wiring",
    "bumper_step_pad": "Worn, torn or missing pad, loose mounting",
    # roof and cargo
    "roof_rail": "Loose or missing end caps, rust at the mounts, cracked rail",
    "roof_rack_crossbar": "Loose or broken clamps, bent bar, missing end caps",
    # pickup
    "tonneau_cover": "Tears or holes, broken latches or clamps, cover that doesn't seal",
    "bed_rail_cap": "Cracked or loose caps, missing stake-pocket covers",
    "bed_liner": "Cracked or loose liner, water trapped underneath, rust showing through",
    "bed_step": "Bent or broken step, loose mounting, step that won't deploy or retract",
    "tailgate_step": "Bent or broken step, step that won't deploy or stow",
    "camper_shell": "Cracks, broken window or latch, torn seal to the bed, loose clamps",
    # cargo
    "spare_tire_cover": "Torn, cracked or missing cover",
    "external_spare_tire_carrier": "Rust, worn or broken cable, carrier that won't raise or lower, loose mounting",
    # commercial and RV
    "luggage_compartment_door": "Dents, broken latch, sagging hinge, torn seal",
    "roof_vent": "Cracked or missing lid, torn seal, broken crank or fan",
    "exterior_ladder": "Bent or broken rungs, loose mounting bolts, rust",
    "rub_rail": "Dents, loose or missing sections",
    "side_guard": "Bent or broken guard, loose or missing mounting bolts",
    # steps and guards
    "running_board": "Cracked, bent or loose board, worn or missing step pad, rusted brackets",
    "side_step": "Bent or loose step, rusted brackets, power step that doesn't deploy or retract",
    "nerf_bar": "Bent or loose bar, rusted brackets, missing step pads",
    "brush_guard": "Bent or loose guard, rusted mounts, blocking lights or sensors",
    "grille_guard": "Bent or loose guard, rusted mounts, blocking lights or sensors",
    "bull_bar": "Bent or loose bar, rusted mounts, blocking lights or sensors",
    # washer and wiper
    "windshield_washer_reservoir": "Cracked reservoir, washer fluid leak, missing cap, broken mount",
    "windshield_washer_pump": "Fluid leaking at the pump grommet, corroded connector, pump that hums with no spray",
    # wheel end
    "wheel_lug_nut": "Missing or loose lug nuts, rounded or swollen-cap lugs, broken or stretched studs, rust trails from a loose wheel",
    "wheel_speed_sensor": "Damaged or chafed wire, cracked or loose sensor, metal debris on the sensor tip, damaged tone ring",
    # tires
    "tpms_sensor": "Corroded valve stem or nut, missing cap, cracked sensor body",
    "spare_tire": "Cracks or dry rot, flat or low, damaged wheel, missing jack or tools",
    # brake system
    "brake_booster": "Cracked or loose vacuum hose or check valve grommet, brake fluid running down the booster shell, rust on the shell",
    # cooling and charging
    "radiator_cooling_fan": "Cracked or missing blades, cracked shroud, chafed wiring, fan that wobbles",
    "alternator": "Cracked case or loose mounting, corroded or loose output terminal, oil or coolant soaking the alternator",
    "starter_motor": "Loose or corroded cables, cracked case, oil soaking the starter, heat-damaged wiring",
    # HVAC
    "ac_compressor": "Oil film at the clutch, seals or fittings (refrigerant oil leak), clutch plate rubbing or wobbling, chafed wiring",
    "ac_condenser": "Bent or blocked fins, oily spots (leaks), stone damage, corrosion",
    "ac_refrigerant_line": "Oily fittings, chafed or kinked lines, cracked hose sections, missing service caps",
    # cabin and safety
    "seat_belt": "Frayed, cut or burned webbing, faded or stiff webbing, cracked buckle, belt that won't retract",
    "seat": "Torn upholstery, broken frame or track, seat that rocks, broken recliner",
    "steering_wheel": "Torn, worn or peeling grip, damaged airbag cover, loose trim",
    "brake_pedal": "Worn-through or missing pedal pad, pedal that sits lower than usual",
    "interior_lamp": "Cracked or missing lens, lamp that doesn't light",
    # driver assistance
    "backup_camera": "Dirty, fogged or cracked lens, misaimed camera, loose mount",
    "adas_forward_camera": "Cracks, chips or haze in the glass in front of the camera, dirty glass, loose or missing camera cover",
    "adas_radar_sensor": "Cracked or chipped sensor face or cover, mud, snow or a plate bracket blocking it, bent mounting",
    "parking_sensor": "Cracked, missing or pushed-in sensors, paint mismatch, dirt or ice covering the sensors",
    # EV
    "electric_drive_unit": "Fluid seeping at the seams or seals, cracked housing, loose mounts, chafed orange cables at the unit (do not touch)",
}

# Visual checks removed: the part can't be seen in a normal inspection, or the part's other checks already cover what
# the eye would see. Each of these parts keeps its other checks.
REMOVE = {
    "automatic_transmission_fluid",  # the level and condition check covers color and smell; leaks are on the pan and housing
    "manual_transmission_fluid",     # the level check covers it; leaks are on the housing and plugs
    "differential_fluid",            # the level check covers it; leaks are on the cover and seals
    "transfer_case_fluid",           # the level check covers it; leaks are on the transfer case
    "diesel_exhaust_fluid",          # the level and quality checks cover it
    "thermostat",                    # inside the housing; the regulation check rates it (the housing has its own visual check)
    "warning_indicator",             # the status check covers it
    "wiper_motor",                   # under the cowl; the operation check rates it
    "cabin_blower_motor",            # behind the dash; the operation check rates it
    "parking_brake_control",         # the hold check rates it
    "wheel_hub_bearing",             # sealed; the play and noise check rates it
}
