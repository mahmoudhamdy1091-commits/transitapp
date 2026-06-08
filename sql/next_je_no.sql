-- نفّذ هذا في Supabase SQL Editor مرة واحدة.
-- يحل مشكلة تضارب entry_no عند الترحيل المتزامن (race condition)
-- عبر عدّاد ذرّي محمي بقفل صفّي على مستوى قاعدة البيانات بدل "اقرأ آخر id ثم +1" من الواجهة.

create table if not exists je_counters (
  system_type text primary key,
  year         int  not null,
  counter      int  not null default 0
);

create or replace function next_je_no(p_sys text)
returns text
language plpgsql
security definer
as $$
declare
  v_year    int := extract(year from now())::int;
  v_counter int;
begin
  insert into je_counters (system_type, year, counter)
  values (p_sys, v_year, 1)
  on conflict (system_type) do update
    set counter = case when je_counters.year = v_year then je_counters.counter + 1 else 1 end,
        year    = v_year
  returning counter into v_counter;

  return 'JE-' || v_year || '-' || lpad(v_counter::text, 5, '0');
end;
$$;

-- السماح للمستخدمين الموثّقين باستدعاء الدالة (RLS على journal_entries تبقى كما هي للحماية الفعلية)
grant execute on function next_je_no(text) to authenticated;
