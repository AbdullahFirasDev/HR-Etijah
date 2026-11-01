-- =============================================================================
-- Etijah HR — 010: non-recording verification pre-check (service_role only)
-- =============================================================================
-- Gives the employee immediate feedback on geofence + network status before the biometric
-- prompt. It is purely informational: record_attendance_event() re-verifies everything.

create or replace function public.attendance_precheck(
  p_employee_id  uuid,
  p_latitude     double precision,
  p_longitude    double precision,
  p_accuracy_m   double precision,
  p_client_ip    inet
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_office_id  uuid;
  v_point      extensions.geography;
  v_geo        record;
  v_network    uuid;
  v_location   jsonb := jsonb_build_object('passed', false, 'reasons', jsonb_build_array('location_unavailable'));
begin
  select e.office_id into v_office_id from public.employees e where e.id = p_employee_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;

  if p_latitude is not null and p_longitude is not null and p_accuracy_m is not null then
    v_point := extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography;
    select g.id, g.name, g.radius_m, g.max_accuracy_m, extensions.st_distance(g.center, v_point) as distance_m
      into v_geo
      from public.geofences g
      join public.offices o on o.id = g.office_id
     where g.is_active and o.is_active
       and (v_office_id is null or g.office_id = v_office_id)
     order by extensions.st_distance(g.center, v_point) - g.radius_m
     limit 1;
    if not found then
      v_location := jsonb_build_object('passed', false, 'reasons', jsonb_build_array('no_geofence_configured'));
    else
      v_location := jsonb_build_object(
        'passed', v_geo.distance_m <= v_geo.radius_m and p_accuracy_m <= v_geo.max_accuracy_m,
        'distance_m', round(v_geo.distance_m::numeric, 1),
        'radius_m', v_geo.radius_m,
        'max_accuracy_m', v_geo.max_accuracy_m,
        'accuracy_m', round(p_accuracy_m::numeric, 1),
        'geofence', v_geo.name,
        'reasons', (
          select coalesce(jsonb_agg(r), '[]'::jsonb) from unnest(array_remove(array[
            case when v_geo.distance_m > v_geo.radius_m then 'outside_geofence' end,
            case when p_accuracy_m > v_geo.max_accuracy_m then 'gps_accuracy_insufficient' end
          ], null)) r));
    end if;
  end if;

  if p_client_ip is not null then
    select n.id into v_network
      from public.allowed_networks n
     where n.is_active
       and (n.office_id is null or v_office_id is null or n.office_id = v_office_id)
       and p_client_ip <<= n.cidr
     limit 1;
  end if;

  return jsonb_build_object(
    'location', v_location,
    'network', jsonb_build_object(
      'passed', v_network is not null,
      'reasons', case when v_network is null then jsonb_build_array(case when p_client_ip is null then 'network_unknown' else 'unauthorized_network' end) else '[]'::jsonb end));
end;
$$;

revoke execute on function public.attendance_precheck(uuid, double precision, double precision, double precision, inet) from public, anon, authenticated;
grant execute on function public.attendance_precheck(uuid, double precision, double precision, double precision, inet) to service_role;
