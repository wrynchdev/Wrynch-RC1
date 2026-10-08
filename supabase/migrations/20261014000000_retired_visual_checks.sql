-- Catalog v1.3.0: every "Visual condition" check now says what to look for on that part. Where there was nothing useful
-- to see (the part is hidden, or its other checks already cover it) the visual check was taken out of the catalog.
-- The rows stay in condition_check so results already recorded keep their history. Listing them as off for every shop
-- means nothing new is recorded on them, and "Nothing found" and confirmed "looks OK" never pick them.
insert into public.platform_disabled_check (check_key, disabled_by)
select key, null from public.condition_check
 where key in (
   'automatic_transmission_fluid.visual', 'manual_transmission_fluid.visual', 'differential_fluid.visual',
   'transfer_case_fluid.visual', 'diesel_exhaust_fluid.visual', 'thermostat.visual', 'warning_indicator.visual',
   'wiper_motor.visual', 'cabin_blower_motor.visual', 'parking_brake_control.visual', 'wheel_hub_bearing.visual')
on conflict (check_key) do nothing;
