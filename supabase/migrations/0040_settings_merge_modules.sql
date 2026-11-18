-- 0040: save_store_settings merged the top level only, so saving a partial `modules` object replaced the whole object
-- and switched every other module back on. The modules object is now merged key by key. Needs 0037.

create or replace function public.save_store_settings(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_k text; v_out jsonb;
        v_text text[] := array['store_name','phone','address','tax_number','footer_sale','footer_return','footer_repair',
                               'footer_installment','footer_wallet','footer_bill','footer_tradein'];
begin
  if not public.has_any_role(array['owner','manager']::public.app_role[]) then raise exception 'not allowed'; end if;
  perform public.enforce_rate_limit('save_settings', 20, 60);
  if jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text) > 20000 then raise exception 'invalid settings'; end if;
  for v_k in select jsonb_object_keys(p_data) loop
    if v_k = any(v_text) then
      if jsonb_typeof(p_data->v_k) <> 'string' or length(p_data->>v_k) > 500 then raise exception 'invalid settings'; end if;
    elsif v_k = 'paper' then
      if (p_data->>v_k) not in ('58mm','80mm','A5','A4') then raise exception 'invalid settings'; end if;
    elsif v_k = 'label' then
      if (p_data->>v_k) not in ('58x40','50x40','50x28','38x25') then raise exception 'invalid settings'; end if;
    elsif v_k in ('show_logo','show_previous_balance') then
      if jsonb_typeof(p_data->v_k) <> 'boolean' then raise exception 'invalid settings'; end if;
    elsif v_k = 'modules' then
      if jsonb_typeof(p_data->v_k) <> 'object' or exists (
           select 1 from jsonb_each(p_data->v_k) e
            where e.key not in ('wallets','bills','maintenance','installments','tradein','inout','online') or jsonb_typeof(e.value) <> 'boolean') then
        raise exception 'invalid settings';
      end if;
    else
      raise exception 'invalid settings';
    end if;
  end loop;
  update public.store_settings s
     set data = (s.data || (p_data - 'modules'))
                || case when p_data ? 'modules' then jsonb_build_object('modules', coalesce(s.data->'modules', '{}'::jsonb) || (p_data->'modules')) else '{}'::jsonb end,
         updated_by = auth.uid(), updated_at = now()
   where s.id
  returning s.data into v_out;
  return v_out;
end $$;

revoke all on function public.save_store_settings(jsonb) from public, anon;
grant execute on function public.save_store_settings(jsonb) to authenticated;
